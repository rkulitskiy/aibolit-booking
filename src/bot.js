const { Telegraf, session, Markup } = require('telegraf');
const database = require('./database');
const eventBus = require('./eventBus');
const moment = require('moment');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Включаем поддержку сессии
bot.use(session());

// Инициализация сессии, если она не определена
bot.use((ctx, next) => {
    if (!ctx.session) {
        ctx.session = {}; // Инициализируем сессию, если она не определена
    }
    return next();
});

bot.start(async (ctx) => {
    const user = {
        id: ctx.from.id,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        username: ctx.from.username,
    };

    try {
        await database.addUser(user);
        ctx.reply('Привет! Я бот для записи к докторам. Вы успешно зарегистрированы.');
    } catch (error) {
        console.error('Ошибка при сохранении пользователя:', error);
        ctx.reply('Произошла ошибка при регистрации. Пожалуйста, попробуйте еще раз.');
    }
});

bot.command('adddoctor', (ctx) => {
    if (!ctx.session) {
        ctx.session = {}; // Инициализируем сессию, если она не определена
    }
    console.log(ctx.session);
    ctx.reply('Введите assignmentId доктора:');
    ctx.session.stage = 'awaiting_assignmentId';
    console.log(ctx.session);
});

bot.command('showdoctors', async (ctx) => {
    try {
        const doctors = await database.getAllDoctors();
        let message = '<b>Список докторов:</b>\n';
        doctors.forEach((doc, index) => {
            const statusEmoji = doc.isEnabled ? '🟢' : '🔴';
            message += `${statusEmoji} ${doc.fullName} - ${doc.position}\n`;
        });
        ctx.replyWithHTML(message);
    } catch (error) {
        console.error('Ошибка при получении списка докторов:', error);
        ctx.reply('Произошла ошибка при получении списка докторов.');
    }
});

bot.command('toggledoctor', async (ctx) => {
    try {
        const doctors = await database.getAllDoctors();
        if (doctors.length === 0) {
            return ctx.reply('В базе данных нет докторов.');
        }

        const buttons = doctors.map(doctor =>
            Markup.button.callback(`${doctor.isEnabled ? '🟢' : '🔴'} ${doctor.fullName}`, `toggle_${doctor._id.toString()}`)
        );

        const inlineKeyboard = Markup.inlineKeyboard(buttons, {columns: 1});
        await ctx.reply('Выберите доктора для изменения статуса:', inlineKeyboard);
    } catch (error) {
        console.error('Ошибка при получении списка докторов:', error);
        ctx.reply('Произошла ошибка при попытке получить список докторов.');
    }
});

bot.action(/^toggle_(.+)/, async (ctx) => {
    const doctorId = ctx.match[1]; // Получаем ID доктора из callback_data кнопки
    try {
        const updatedDoctor = await database.toggleDoctorEnabledState(doctorId);
        // Сначала ответим на callback_query, чтобы у пользователя не висел "часик" в интерфейсе Telegram
        await ctx.answerCbQuery(`Статус доктора '${updatedDoctor.fullName}' изменен на ${updatedDoctor.isEnabled ? 'включен' : 'выключен'}.`);

        // Затем попытаемся отредактировать сообщение
        try {
            await ctx.editMessageText(`Доктор ${updatedDoctor.fullName} был успешно ${updatedDoctor.isEnabled ? 'включен' : 'выключен'}.`);
        } catch (error) {
            if (error.response && error.response.error_code === 400 && error.response.description.startsWith("Bad Request: message is not modified")) {
                console.log("Игнорируем ошибку неизмененного сообщения");
            } else {
                // Если ошибка не связана с неизмененным сообщением, выбрасываем её дальше
                throw error;
            }
        }
    } catch (error) {
        console.error('Ошибка при обновлении статуса доктора:', error);
    }
});

bot.command('slots', async (ctx) => {
    try {
        const doctors = await database.getAllDoctors();
        if (doctors.length === 0) {
            return ctx.reply('В базе данных нет докторов.');
        }

        // Создаем кнопки для каждого доктора
        const buttons = doctors.map((doctor) =>
            Markup.button.callback(`${doctor.fullName}`, `slots_${doctor._id}`)
        );

        const inlineKeyboard = Markup.inlineKeyboard(buttons, { columns: 1 });
        await ctx.reply('Выберите доктора:', inlineKeyboard);
    } catch (error) {
        console.error('Ошибка при получении списка докторов:', error);
        ctx.reply('Произошла ошибка при попытке получить список докторов.');
    }
});

bot.action(/^slots_(.+)$/, async (ctx) => {
    const doctorId = ctx.match[1];
    try {
        const doctor = await database.getDoctorById(doctorId);
        const slots = await database.getActualSlotsForDoctor(doctor);

        if (slots && slots.length > 0) {
            let message = `Доступные слоты для доктора <b>${doctor.fullName}</b> на ближайшие 2 недели:\n`;
            // Группировка слотов по датам
            const slotsByDate = slots.reduce((acc, slot) => {
                const date = moment(slot.start).format('DD.MM.YYYY');
                if (!acc[date]) {
                    acc[date] = [];
                }
                acc[date].push(slot);
                return acc;
            }, {});

            Object.entries(slotsByDate).forEach(([date, slots]) => {
                message += `\n<b>📅 ${date}:</b>\n`;
                slots.forEach(slot => {
                    message += ` 🕒 ${moment(slot.start).format('HH:mm')}\n`;
                });
            });

            await ctx.editMessageText(message, { parse_mode: 'HTML' });
        } else {
            await ctx.answerCbQuery('Для данного доктора нет доступных слотов.');
        }
    } catch (error) {
        console.error('Ошибка при извлечении слотов:', error);
        await ctx.answerCbQuery('Произошла ошибка при извлечении доступных слотов.');
    }
});

bot.on('text', async (ctx) => {
    if (!ctx.session) {
        ctx.session = {}; // Гарантированно инициализируем сессию, если её нет
    }

    if (!ctx.session.stage) {
        return; // Если стадия не установлена, игнорируем текстовые сообщения
    }

    switch (ctx.session.stage) {
        case 'awaiting_assignmentId':
            ctx.session.doctor = { assignmentId: ctx.message.text };
            ctx.reply('Введите physicianId доктора:');
            ctx.session.stage = 'awaiting_physicianId';
            break;
        case 'awaiting_physicianId':
            ctx.session.doctor.physicianId = ctx.message.text;
            ctx.reply('Введите специализацию доктора:');
            ctx.session.stage = 'awaiting_position';
            break;
        case 'awaiting_position':
            ctx.session.doctor.position = ctx.message.text;
            ctx.reply('Введите полное имя доктора:');
            ctx.session.stage = 'awaiting_fullName';
            break;
        case 'awaiting_fullName':
            ctx.session.doctor.fullName = ctx.message.text;
            ctx.session.doctor.isEnabled = true;
            try {
                await database.addDoctor(ctx.session.doctor);

                // После добавления доктора запрашиваем обновление расписания
                eventBus.emit('update-schedule');

                ctx.reply('Доктор успешно добавлен');
            } catch (error) {
                console.error('Ошибка при добавлении доктора:', error);
                ctx.reply('Произошла ошибка при добавлении доктора.');
            }
            ctx.session.stage = undefined; // Очищаем этап диалога
            break;
    }
});

// Функция для запуска бота
async function launchBot() {
    await bot.launch();
    console.log('Telegram bot launched');
}

// Слушаем события от scheduler.js через eventBus
eventBus.on('notifyUser', (data) => {
    bot.telegram.sendMessage(data.userId, data.message, { parse_mode: 'HTML' }).catch(error => {
        console.error(`Error sending notification to user ${data.userId}:`, error);
    });
});

module.exports = { launchBot };
