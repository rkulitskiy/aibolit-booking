const axios = require('axios');
const database = require('./database');
const cron = require('node-cron');
const moment = require('moment');
const eventBus = require('./eventBus');
const providersManager = require('./providers/manager');

async function updateDoctorsTimeSlots() {
    console.log('⏰ Starting to update doctor time slots...');
    
    // Обновляем слоты для Aibolit.md
    await updateAibolitDoctorsTimeSlots();
    
    // Обновляем слоты для ЛОДЭ
    await updateLodeDoctorsTimeSlots();
    
    console.log('✅ Finished updating doctor time slots');
}

async function updateAibolitDoctorsTimeSlots() {
    try {
        const doctors = await database.getEnabledDoctorsByProvider('aibolit');
        const dateStart = moment().format('YYYY-MM-DD');
        const dateEnd = moment().add(1, 'month').format('YYYY-MM-DD');

        console.log(`⚕️ Updating slots for ${doctors.length} Aibolit.md doctors`);

    for (const doctor of doctors) {
        try {
            const response = await axios.get(`https://my2.aibolit.md/api/v2/my/providers/timetables`, {
                params: {
                    assignmentId: doctor.assignmentId,
                    dateStart,
                    dateEnd,
                    physicianId: doctor.physicianId
                }
            });

            if (response.data && response.data[0] && response.data[0].timetable) {
                const newSlots = response.data[0].timetable;
                newSlots.sort((a, b) => new Date(a.start) - new Date(b.start));

                // Получаем текущие слоты из базы данных
                const currentSlots = await database.getDoctorTimeSlots(doctor._id) || [];

                // Обновляем все слоты в базе данных
                await database.updateDoctorTimeSlots(doctor._id, newSlots);

                // Определяем новые слоты для уведомлений, сравнивая со слотами до обновления
                const slotsToNotify = newSlots.filter(newSlot => !currentSlots.some(currentSlot => newSlot.id === currentSlot.id));

                // Уведомляем пользователей о новых слотах, которые не были в базе до обновления
                if (slotsToNotify.length > 0) {
                    slotsToNotify.forEach(slot => notifyUsersAboutNewSlot(doctor, slot));
                    console.log(`Notified about new slots for doctor ${doctor.fullName} (Aibolit.md)`);
                }

                console.log(`Time slots updated for doctor ${doctor.fullName} (Aibolit.md)`);
            }
        } catch (error) {
            console.error(`Error updating time slots for doctor ${doctor.fullName} (Aibolit.md):`, error);
        }
    }
    } catch (dbError) {
        console.error('⚕️ Ошибка подключения к БД для Aibolit.md:', dbError.message);
        console.log('⚕️ Проверьте настройки MongoDB или отключите провайдер Aibolit.md');
    }
}

async function updateLodeDoctorsTimeSlots() {
    try {
        // Пытаемся получить врачей из базы данных
        const doctors = await database.getEnabledDoctorsByProvider('lode');
        const dateStart = moment().format('YYYY-MM-DD');
        const dateEnd = moment().add(1, 'month').format('YYYY-MM-DD');

        console.log(`🏥 Updating slots for ${doctors.length} ЛОДЭ doctors`);

    const lodeProvider = providersManager.getProvider('lode');
    if (!lodeProvider) {
        console.error('ЛОДЭ provider not found');
        return;
    }

    for (const doctor of doctors) {
        try {
            // Используем провайдер ЛОДЭ для получения слотов
            const newSlots = await lodeProvider.getDoctorSlots(doctor, dateStart, dateEnd);

            if (newSlots && newSlots.length > 0) {
                // Получаем текущие слоты из базы данных
                const currentSlots = await database.getDoctorTimeSlots(doctor._id) || [];

                // Обновляем все слоты в базе данных
                await database.updateDoctorTimeSlots(doctor._id, newSlots);

                // Определяем новые слоты для уведомлений
                const slotsToNotify = newSlots.filter(newSlot => !currentSlots.some(currentSlot => newSlot.id === currentSlot.id));

                // Уведомляем пользователей о новых слотах
                if (slotsToNotify.length > 0) {
                    slotsToNotify.forEach(slot => notifyUsersAboutNewSlot(doctor, slot));
                    console.log(`Notified about new slots for doctor ${doctor.fullName} (ЛОДЭ)`);
                }

                console.log(`Time slots updated for doctor ${doctor.fullName} (ЛОДЭ)`);
            }
        } catch (error) {
            console.error(`Error updating time slots for doctor ${doctor.fullName} (ЛОДЭ):`, error);
        }
    }
    } catch (dbError) {
        console.error('🏥 Ошибка подключения к БД для ЛОДЭ:', dbError.message);
    }
}

function notifyUsersAboutNewSlot(doctor, slot) {
    let formattedDate;
    
    if (doctor.provider === 'lode') {
        // Для ЛОДЭ используем поля date и time из API (уже в местной зоне)
        formattedDate = `${slot.date} ${slot.time}`;
    } else {
        // Для других провайдеров конвертируем UTC в местное время Минска (UTC+3)
        const localTime = moment(slot.start).utcOffset('+03:00');
        formattedDate = localTime.format('DD.MM.YYYY HH:mm');
    }
    
    const providerIcon = doctor.provider === 'lode' ? '🏥' : '⚕️';
    const providerName = doctor.provider === 'lode' ? 'ЛОДЭ' : 'Aibolit.md';
    
    let message = `🕒 Доступен новый слот у доктора ${doctor.fullName} (${doctor.position}): <b>${formattedDate}</b>\n`;
    message += `${providerIcon} Медцентр: ${providerName}`;
    
    if (doctor.center) {
        message += `\n📍 ${doctor.center}`;
    }

    database.getAllUsers().then(users => {
        users.forEach(user => {
            eventBus.emit('notifyUser', { userId: user.id, message: message });
        });
    }).catch(error => {
        console.error(`Error notifying users about new slot:`, error);
    });
}

// Инициализируем планировщик (каждые 5 минут)
cron.schedule('*/1 * * * *', async () => {
    console.log('⏰ Starting scheduled task:', moment().format('YYYY-MM-DD HH:mm:ss'));
    await updateDoctorsTimeSlots();
});
console.log('⏰ Планировщик инициализирован с интервалом: */5 * * * *');

// Подписываемся на событие 'update-schedule'
eventBus.on('update-schedule', updateDoctorsTimeSlots);

module.exports = { updateDoctorsTimeSlots };
