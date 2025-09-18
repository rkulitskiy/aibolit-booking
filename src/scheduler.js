const axios = require('axios');
const database = require('./database');
const cron = require('node-cron');
const moment = require('moment');
const eventBus = require('./eventBus');
const providersManager = require('./providers/manager');

// Хранилище для отслеживания уже найденных МРТ слотов
let lastMrtSlots = new Set();
let isFirstMrtCheck = true; // Флаг первой проверки

// Настройки МРТ мониторинга через ENV
const MRT_MONITORING_ENABLED = process.env.MRT_MONITORING_ENABLED !== 'false'; // по умолчанию включено
const MRT_REQUIRE_CONSECUTIVE_SLOTS = process.env.MRT_REQUIRE_CONSECUTIVE_SLOTS === 'true';

function findConsecutiveSlots(slots) {
    const consecutivePairs = [];
    
    // Группируем слоты по дате
    const slotsByDate = {};
    slots.forEach(slot => {
        if (!slotsByDate[slot.date]) {
            slotsByDate[slot.date] = [];
        }
        slotsByDate[slot.date].push(slot);
    });
    
    // Ищем парные слоты для каждой даты
    Object.keys(slotsByDate).forEach(date => {
        const daySlots = slotsByDate[date];
        
        // Сортируем слоты по времени
        daySlots.sort((a, b) => a.time.localeCompare(b.time));
        
        // Ищем пары с интервалом 30 минут
        for (let i = 0; i < daySlots.length - 1; i++) {
            const currentSlot = daySlots[i];
            const nextSlot = daySlots[i + 1];
            
            const currentTime = moment(`${date}T${currentSlot.time}`);
            const nextTime = moment(`${date}T${nextSlot.time}`);
            
            // Проверяем что следующий слот через 30 минут
            const diffMinutes = nextTime.diff(currentTime, 'minutes');
            if (diffMinutes === 30) {
                consecutivePairs.push({
                    slot1: currentSlot,
                    slot2: nextSlot,
                    date: date,
                    startTime: currentSlot.time,
                    endTime: nextSlot.time
                });
            }
        }
    });
    
    return consecutivePairs;
}

function clearMrtSlotsMemory() {
    const previousSize = lastMrtSlots.size;
    const previousPairsSize = global.lastMrtPairs ? global.lastMrtPairs.size : 0;
    
    lastMrtSlots.clear();
    if (global.lastMrtPairs) {
        global.lastMrtPairs.clear();
    }
    isFirstMrtCheck = true; // Сбрасываем флаг первой проверки
    
    console.log(`🧹 Память МРТ слотов очищена. Было: ${previousSize} слотов, ${previousPairsSize} пар`);
    console.log(`ℹ️ При следующей проверке будут показаны слоты на ближайшие 3 дня`);
    return `Очищено ${previousSize} слотов и ${previousPairsSize} пар из памяти`;
}

async function updateDoctorsTimeSlots() {
    const startTime = Date.now();
    console.log('⏰ Starting to update doctor time slots...');
    
    await updateAibolitDoctorsTimeSlots();
    
    await updateLodeDoctorsTimeSlots();
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    console.log(`✅ Finished updating doctor time slots (${duration}ms)`);
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
    const startTime = Date.now();
    try {
        console.log(`🔍 [${moment().format('HH:mm:ss')}] Проверка МРТ слотов...`);
        
        const today = moment();
        const endDate = moment().add(1, 'month'); // Проверяем на месяц вперед
        
        const startParam = today.format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
        const endParam = endDate.format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
        
        console.log(`📡 [${moment().format('HH:mm:ss')}] Запрос к API Lode: ${startParam} → ${endParam}`);
        const apiStartTime = Date.now();
        
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
        
        const apiEndTime = Date.now();
        const apiDuration = apiEndTime - apiStartTime;
        console.log(`📡 [${moment().format('HH:mm:ss')}] API ответ получен за ${apiDuration}ms`);
        
        if (response.data && response.data.tickets) {
            // Фильтруем все МРТ слоты (любое время и дата)
            const relevantSlots = response.data.tickets.filter(ticket => {
                return ticket.uslugs_ids && ticket.uslugs_ids.includes(39);
            });
            
            // Используем все слоты без фильтрации по времени
            const workingHoursSlots = relevantSlots;
            
            console.log(`🔍 [${moment().format('HH:mm:ss')}] Найдено ${workingHoursSlots.length} МРТ слотов (все доступные)`);
            
            // Проверяем наличие новых слотов
            const newSlots = workingHoursSlots.filter(slot => !lastMrtSlots.has(slot.id));
            
            if (newSlots.length > 0) {
                console.log(`🆕 [${moment().format('HH:mm:ss')}] Найдено ${newSlots.length} новых МРТ слотов!`);
                
                // Сортируем новые слоты по дате (самые ранние первыми)
                newSlots.sort((a, b) => new Date(a.start || `${a.date}T${a.time}`) - new Date(b.start || `${b.date}T${b.time}`));
                
                // Обновляем список известных слотов
                newSlots.forEach(slot => lastMrtSlots.add(slot.id));
                
                if (isFirstMrtCheck) {
                    // При первой проверке только сохраняем слоты, но не уведомляем
                    console.log(`📝 [${moment().format('HH:mm:ss')}] Первая проверка: сохранено ${newSlots.length} существующих МРТ слотов в память`);
                    
                    // Показываем слоты на ближайшие 3 дня для информации
                    const today = moment();
                    const nearSlots = newSlots.filter(slot => {
                        const slotDate = moment(slot.date);
                        const daysDiff = slotDate.diff(today, 'days');
                        return daysDiff >= 0 && daysDiff <= 3;
                    });
                    
                    if (nearSlots.length > 0) {
                        if (MRT_REQUIRE_CONSECUTIVE_SLOTS) {
                            // Ищем парные слоты в ближайших
                            const nearConsecutivePairs = findConsecutiveSlots(nearSlots);
                            
                            console.log(`📋 Доступные МРТ слоты на ближайшие 3 дня (${nearSlots.length} шт.):`);
                            nearSlots.slice(0, 10).forEach((slot, index) => {
                                const daysFromNow = moment(slot.date).diff(today, 'days');
                                const dayText = daysFromNow === 0 ? 'сегодня' : 
                                              daysFromNow === 1 ? 'завтра' : 
                                              daysFromNow === 2 ? 'послезавтра' : 
                                              `через ${daysFromNow} дня`;
                                console.log(`  ${index + 1}. ${slot.date} ${slot.time} (${dayText})`);
                            });
                            if (nearSlots.length > 10) {
                                console.log(`  ... и еще ${nearSlots.length - 10} слотов`);
                            }
                            
                            if (nearConsecutivePairs.length > 0) {
                                console.log(`\n🔥 Найдено ${nearConsecutivePairs.length} парных слотов для сосудистой программы:`);
                                nearConsecutivePairs.slice(0, 5).forEach((pair, index) => {
                                    const daysFromNow = moment(pair.date).diff(today, 'days');
                                    const dayText = daysFromNow === 0 ? 'сегодня' : 
                                                  daysFromNow === 1 ? 'завтра' : 
                                                  daysFromNow === 2 ? 'послезавтра' : 
                                                  `через ${daysFromNow} дня`;
                                    console.log(`  ${index + 1}. ${pair.date} ${pair.startTime}-${pair.endTime} (${dayText}) - 1 ЧАС`);
                                });
                            } else {
                                console.log(`\n⚠️ Парных слотов на ближайшие 3 дня не найдено`);
                            }
                        } else {
                            console.log(`📋 Доступные МРТ слоты на ближайшие 3 дня (${nearSlots.length} шт.):`);
                            nearSlots.slice(0, 10).forEach((slot, index) => {
                                const daysFromNow = moment(slot.date).diff(today, 'days');
                                const dayText = daysFromNow === 0 ? 'сегодня' : 
                                              daysFromNow === 1 ? 'завтра' : 
                                              daysFromNow === 2 ? 'послезавтра' : 
                                              `через ${daysFromNow} дня`;
                                console.log(`  ${index + 1}. ${slot.date} ${slot.time} (${dayText})`);
                            });
                            if (nearSlots.length > 10) {
                                console.log(`  ... и еще ${nearSlots.length - 10} слотов`);
                            }
                        }
                    } else {
                        console.log(`ℹ️ Нет доступных МРТ слотов на ближайшие 3 дня`);
                        
                        // Показываем самый ранний доступный слот
                        if (newSlots.length > 0) {
                            const earliestSlot = newSlots[0]; // уже отсортированы по дате
                            const daysFromNow = moment(earliestSlot.date).diff(today, 'days');
                            console.log(`📅 Ближайший доступный слот: ${earliestSlot.date} ${earliestSlot.time} (через ${daysFromNow} дней)`);
                        }
                    }
                    
                    isFirstMrtCheck = false;
                } else {
                    // При последующих проверках уведомляем о новых слотах
                    if (MRT_REQUIRE_CONSECUTIVE_SLOTS) {
                        // Режим парных слотов - ищем пары среди ВСЕХ слотов, но уведомляем только о новых парах
                        const allConsecutivePairs = findConsecutiveSlots(workingHoursSlots);
                        
                        // Создаем уникальный ключ для каждой пары
                        const pairKey = (pair) => `${pair.date}_${pair.startTime}_${pair.endTime}`;
                        
                        // Фильтруем только новые пары (которых не было в предыдущей проверке)
                        if (!global.lastMrtPairs) {
                            global.lastMrtPairs = new Set();
                        }
                        
                        const newPairs = allConsecutivePairs.filter(pair => !global.lastMrtPairs.has(pairKey(pair)));
                        
                        if (newPairs.length > 0) {
                            console.log(`🔥 [${moment().format('HH:mm:ss')}] Найдено ${newPairs.length} новых парных МРТ слотов (для сосудистой программы)!`);
                            
                            // Обновляем список известных пар
                            newPairs.forEach(pair => global.lastMrtPairs.add(pairKey(pair)));
                            
                            const pairsToNotify = newPairs.length > 3 ? newPairs.slice(0, 3) : newPairs;
                            pairsToNotify.forEach(pair => notifyUsersAboutNewMrtConsecutiveSlots(pair));
                            
                            if (newPairs.length > 3) {
                                console.log(`📝 Показано уведомлений о первых 3 парах из ${newPairs.length} найденных`);
                            }
                        } else if (newSlots.length > 0) {
                            console.log(`ℹ️ Новые МРТ слоты найдены (${newSlots.length}), но новых парных слотов нет`);
                        }
                    } else {
                        // Обычный режим - уведомляем о всех новых слотах
                        const slotsToNotify = newSlots.length > 5 ? newSlots.slice(0, 5) : newSlots;
                        slotsToNotify.forEach(slot => notifyUsersAboutNewMrtSlot(slot));
                        
                        if (newSlots.length > 5) {
                            console.log(`📝 Показано уведомлений о первых 5 слотах из ${newSlots.length} новых`);
                        }
                    }
                }
            } else {
                console.log(`ℹ️ [${moment().format('HH:mm:ss')}] Новых МРТ слотов не найдено. В памяти: ${lastMrtSlots.size} известных слотов`);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка при проверке МРТ слотов:', error.message);
    } finally {
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`✅ [${moment().format('HH:mm:ss')}] МРТ проверка завершена за ${duration}ms`);
    }
}

function notifyUsersAboutNewMrtSlot(slot) {
    const formattedDate = `${slot.date} ${slot.time}`;
    
    let message = `🩻 <b>НОВЫЙ СЛОТ МРТ БЕЗ КОНТРАСТА!</b>\n`;
    message += `📅 Дата и время: <b>${formattedDate}</b>\n`;
    message += `🏥 Медцентр: ЛОДЭ\n`;

    database.getAllUsers().then(users => {
        users.forEach(user => {
            eventBus.emit('notifyUser', { userId: user.id, message: message });
        });
    }).catch(error => {
        console.error(`Error notifying users about new MRT slot:`, error);
    });
}

function notifyUsersAboutNewMrtConsecutiveSlots(consecutivePair) {
    const startTimeFormatted = consecutivePair.startTime.replace(':', '.');
    const endTimeFormatted = consecutivePair.endTime.replace(':', '.');
    
    let message = `🩻 <b>НОВЫЕ ПАРНЫЕ СЛОТЫ МРТ!</b>\n`;
    message += `📅 Дата: <b>${consecutivePair.date}</b>\n`;
    message += `🕐 Время: <b>${startTimeFormatted} и ${endTimeFormatted}</b>\n`;
    message += `🏥 Медцентр: ЛОДЭ\n`;

    database.getAllUsers().then(users => {
        users.forEach(user => {
            eventBus.emit('notifyUser', { userId: user.id, message: message });
        });
    }).catch(error => {
        console.error(`Error notifying users about new consecutive MRT slots:`, error);
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
cron.schedule('*/2 * * * *', async () => {
    console.log('⏰ Starting scheduled task:', moment().format('YYYY-MM-DD HH:mm:ss'));
    await updateDoctorsTimeSlots();
});

// Отдельный cron для мониторинга МРТ слотов (каждую минуту)
if (MRT_MONITORING_ENABLED) {
    cron.schedule('* * * * *', async () => {
        console.log('🩻 Starting MRT slots check:', moment().format('YYYY-MM-DD HH:mm:ss'));
        await checkMrtSlots();
    });
}

console.log('⏰ Планировщик инициализирован с интервалом: */5 * * * *');

if (MRT_MONITORING_ENABLED) {
    console.log('🩻 МРТ монитор инициализирован с интервалом: * * * * * (каждую минуту)');
    console.log(`🔧 МРТ режим: ${MRT_REQUIRE_CONSECUTIVE_SLOTS ? 'ПАРНЫЕ СЛОТЫ (для сосудистой программы)' : 'ВСЕ СЛОТЫ'}`);
} else {
    console.log('🚫 МРТ мониторинг ОТКЛЮЧЕН (MRT_MONITORING_ENABLED=false)');
}

eventBus.on('update-schedule', updateDoctorsTimeSlots);

module.exports = { updateDoctorsTimeSlots, checkMrtSlots, clearMrtSlotsMemory };
