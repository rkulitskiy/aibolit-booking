const axios = require('axios');
const database = require('./database');
const cron = require('node-cron');
const moment = require('moment');
const eventBus = require('./eventBus');
const providersManager = require('./providers/manager');

// Хранилище для отслеживания уже найденных МРТ слотов
let lastMrtSlots = new Set();

async function updateDoctorsTimeSlots() {
    console.log('⏰ Starting to update doctor time slots...');
    
    await updateAibolitDoctorsTimeSlots();
    
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

                const currentSlots = await database.getDoctorTimeSlots(doctor._id) || [];

                await database.updateDoctorTimeSlots(doctor._id, newSlots);

                const slotsToNotify = newSlots.filter(newSlot => !currentSlots.some(currentSlot => newSlot.id === currentSlot.id));

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
            const newSlots = await lodeProvider.getDoctorSlots(doctor, dateStart, dateEnd);

            if (newSlots && newSlots.length > 0) {
                const currentSlots = await database.getDoctorTimeSlots(doctor._id) || [];

                await database.updateDoctorTimeSlots(doctor._id, newSlots);

                const slotsToNotify = newSlots.filter(newSlot => !currentSlots.some(currentSlot => newSlot.id === currentSlot.id));

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

async function checkMrtSlots() {
    try {
        console.log('🔍 Проверка МРТ слотов...');
        
        const today = moment();
        const endDate = moment().add(1, 'month'); // Проверяем на месяц вперед
        
        const startParam = today.format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
        const endParam = endDate.format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
        
        const response = await axios.get('https://z-api-lode.vot.by/getAllData', {
            params: {
                start: startParam,
                end: endParam,
                usluga: 39 // МРТ без контрастного усиления
            },
            headers: {
                'Accept': '*/*',
                'Accept-Language': 'ru-RU,ru;q=0.9',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Origin': 'https://www.lode.by',
                'Referer': 'https://www.lode.by/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
            }
        });
        
        if (response.data && response.data.tickets) {
            // Фильтруем все МРТ слоты (любое время и дата)
            const relevantSlots = response.data.tickets.filter(ticket => {
                return ticket.uslugs_ids && ticket.uslugs_ids.includes(39);
            });
            
            // Используем все слоты без фильтрации по времени
            const workingHoursSlots = relevantSlots;
            
            console.log(`🔍 Найдено ${workingHoursSlots.length} МРТ слотов (все доступные)`);
            
            // Проверяем наличие новых слотов
            const newSlots = workingHoursSlots.filter(slot => !lastMrtSlots.has(slot.id));
            
            if (newSlots.length > 0) {
                console.log(`🆕 Найдено ${newSlots.length} новых МРТ слотов!`);
                
                // Сортируем новые слоты по дате (самые ранние первыми)
                newSlots.sort((a, b) => new Date(a.start || `${a.date}T${a.time}`) - new Date(b.start || `${b.date}T${b.time}`));
                
                // Обновляем список известных слотов
                newSlots.forEach(slot => lastMrtSlots.add(slot.id));
                
                // Уведомляем о новых слотах (показываем только самые ранние если их много)
                const slotsToNotify = newSlots.length > 5 ? newSlots.slice(0, 5) : newSlots;
                slotsToNotify.forEach(slot => notifyUsersAboutNewMrtSlot(slot));
                
                if (newSlots.length > 5) {
                    console.log(`📝 Показано уведомлений о первых 5 слотах из ${newSlots.length} новых`);
                }
            } else {
                console.log(`ℹ️ Новых МРТ слотов не найдено. В памяти: ${lastMrtSlots.size} известных слотов`);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке МРТ слотов:', error.message);
    }
}

function notifyUsersAboutNewMrtSlot(slot) {
    const formattedDate = `${slot.date} ${slot.time}`;
    
    let message = `🩻 <b>НОВЫЙ СЛОТ МРТ БЕЗ КОНТРАСТА!</b>\n`;
    message += `📅 Дата и время: <b>${formattedDate}</b>\n`;
    message += `🏥 Медцентр: ЛОДЭ\n`;
    message += `🆔 ID слота: ${slot.id}\n`;
    message += `\n⚡ Быстрее записывайтесь!`;

    database.getAllUsers().then(users => {
        users.forEach(user => {
            eventBus.emit('notifyUser', { userId: user.id, message: message });
        });
    }).catch(error => {
        console.error(`Error notifying users about new MRT slot:`, error);
    });
}

function notifyUsersAboutNewSlot(doctor, slot) {
    let formattedDate;
    
    if (doctor.provider === 'lode') {
        formattedDate = `${slot.date} ${slot.time}`;
    } else {
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

// Основной cron для обновления слотов докторов (каждые 5 минут)
cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ Starting scheduled task:', moment().format('YYYY-MM-DD HH:mm:ss'));
    await updateDoctorsTimeSlots();
});

// Отдельный cron для мониторинга МРТ слотов (каждую минуту)
cron.schedule('* * * * *', async () => {
    console.log('🩻 Starting MRT slots check:', moment().format('YYYY-MM-DD HH:mm:ss'));
    await checkMrtSlots();
});

console.log('⏰ Планировщик инициализирован с интервалом: */5 * * * *');
console.log('🩻 МРТ монитор инициализирован с интервалом: * * * * * (каждую минуту)');

eventBus.on('update-schedule', updateDoctorsTimeSlots);

module.exports = { updateDoctorsTimeSlots, checkMrtSlots };
