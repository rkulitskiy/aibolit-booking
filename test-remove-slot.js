// Скрипт для удаления одного слота у врача ЛОДЭ и у врача Aibolit для тестирования уведомлений
require('dotenv').config();
const { MongoClient } = require('mongodb');
const moment = require('moment');

async function removeSlotForTesting() {
    const client = new MongoClient(process.env.MONGODB_URI);
    
    try {
        await client.connect();
        console.log('✅ Подключен к MongoDB');
        
        const db = client.db('aibolit-booking');
        const doctorsCollection = db.collection('doctors');
        const timeSlotsCollection = db.collection('timeSlots');
        
        // Найдем включенного врача Aibolit
        const aibolitDoctor = await doctorsCollection.findOne({
            provider: 'aibolit',
            isEnabled: true
        });
        
        // Найдем включенного врача ЛОДЭ
        const lodeDoctor = await doctorsCollection.findOne({
            provider: 'lode',
            isEnabled: true
        });
        
        let removedCount = 0;
        
        // Удаляем слот у врача Aibolit
        if (aibolitDoctor) {
            removedCount += await removeSlotFromDoctor(db, aibolitDoctor, 'Aibolit');
        } else {
            console.log('⚠️ Включенный врач Aibolit не найден');
        }
        
        // Удаляем слот у врача ЛОДЭ
        if (lodeDoctor) {
            removedCount += await removeSlotFromDoctor(db, lodeDoctor, 'ЛОДЭ');
        } else {
            console.log('⚠️ Включенный врач ЛОДЭ не найден');
        }
        
        if (removedCount === 0) {
            console.log('❌ Не удалось удалить ни одного слота');
            return;
        }
        
        console.log('');
        console.log('🔔 Теперь при следующем обновлении планировщика эти слоты должны:');
        console.log('   1. Быть найдены снова через API провайдеров');
        console.log('   2. Определены как "новые"');
        console.log('   3. Отправлены уведомления в бота');
        console.log('');
        console.log('⏰ Запустите планировщик или подождите автообновления');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.close();
        console.log('🔌 Отключен от MongoDB');
    }
}

// Функция для удаления слота у конкретного врача
async function removeSlotFromDoctor(db, doctor, providerName) {
    const timeSlotsCollection = db.collection('timeSlots');
    
    // Найдем слоты этого врача в коллекции timeSlots
    const timeSlotsDoc = await timeSlotsCollection.findOne({ doctorId: doctor._id });
    
    if (!timeSlotsDoc || !timeSlotsDoc.slots || timeSlotsDoc.slots.length === 0) {
        console.log(`⚠️ У врача ${providerName} (${doctor.fullName}) нет слотов для удаления`);
        return 0;
    }
    
    console.log(`\n🏥 ${providerName}: ${doctor.fullName}`);
    console.log(`📅 Текущее количество слотов: ${timeSlotsDoc.slots.length}`);
    
    // Удаляем последний слот
    const slotToRemove = timeSlotsDoc.slots[timeSlotsDoc.slots.length - 1];
    
    const result = await timeSlotsCollection.updateOne(
        { doctorId: doctor._id },
        { $pull: { slots: { id: slotToRemove.id } } }
    );
    
    if (result.modifiedCount > 0) {
        console.log('✅ Слот успешно удален!');
        
        // Показываем информацию о слоте в зависимости от провайдера
        if (providerName === 'ЛОДЭ') {
            console.log(`🗑️ Удаленный слот: ${slotToRemove.date} ${slotToRemove.time}`);
        } else {
            // Для Aibolit показываем время в формате UTC
            const slotTime = moment(slotToRemove.start).format('DD.MM.YYYY HH:mm');
            console.log(`🗑️ Удаленный слот: ${slotTime}`);
        }
        
        console.log(`📊 Осталось слотов: ${timeSlotsDoc.slots.length - 1}`);
        return 1;
    } else {
        console.log(`❌ Не удалось удалить слот у врача ${providerName}`);
        return 0;
    }
}

// Запуск
removeSlotForTesting().catch(console.error); 