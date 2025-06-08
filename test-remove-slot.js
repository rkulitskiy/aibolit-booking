// Скрипт для удаления одного слота врача ЛОДЭ для тестирования уведомлений
const { MongoClient } = require('mongodb');

async function removeSlotForTesting() {
    const client = new MongoClient('mongodb://localhost:27017');
    
    try {
        await client.connect();
        console.log('✅ Подключен к MongoDB');
        
        const db = client.db('aibolit-booking');
        const doctorsCollection = db.collection('doctors');
        const timeSlotsCollection = db.collection('timeSlots');
        
        // Найдем врача ЛОДЭ
        const doctor = await doctorsCollection.findOne({
            provider: 'lode'
        });
        
        if (!doctor) {
            console.log('❌ Врач ЛОДЭ не найден');
            return;
        }
        
        // Найдем слоты этого врача в коллекции timeSlots
        const timeSlotsDoc = await timeSlotsCollection.findOne({ doctorId: doctor._id });
        
        if (!timeSlotsDoc || !timeSlotsDoc.slots || timeSlotsDoc.slots.length === 0) {
            console.log('⚠️ У врача нет слотов для удаления');
            return;
        }
        
        console.log(`🏥 Найден врач: ${doctor.fullName}`);
        console.log(`📅 Текущее количество слотов: ${timeSlotsDoc.slots.length}`);
        
        // Удаляем последний слот
        const slotToRemove = timeSlotsDoc.slots[timeSlotsDoc.slots.length - 1];
        
        const result = await timeSlotsCollection.updateOne(
            { doctorId: doctor._id },
            { $pull: { slots: { id: slotToRemove.id } } }
        );
        
        if (result.modifiedCount > 0) {
            console.log('✅ Слот успешно удален!');
            console.log(`🗑️ Удаленный слот: ${slotToRemove.date} ${slotToRemove.time}`);
            console.log(`📊 Осталось слотов: ${timeSlotsDoc.slots.length - 1}`);
            console.log('');
            console.log('🔔 Теперь при следующем обновлении планировщика этот слот должен:');
            console.log('   1. Быть найден снова через API ЛОДЭ');
            console.log('   2. Определен как "новый"');
            console.log('   3. Отправлено уведомление в бота');
            console.log('');
            console.log('⏰ Запустите планировщик или подождите автообновления');
        } else {
            console.log('❌ Не удалось удалить слот');
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await client.close();
        console.log('🔌 Отключен от MongoDB');
    }
}

// Запуск
removeSlotForTesting().catch(console.error); 