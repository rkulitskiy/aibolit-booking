const { Telegraf, session } = require('telegraf');
const database = require('./database');
const eventBus = require('./eventBus');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Включаем поддержку сессии
bot.use(session());

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
    ctx.reply('Введите assignmentId доктора:');
    ctx.session.stage = 'awaiting_assignmentId';
});

bot.command('showdoctors', async (ctx) => {
    try {
        const doctors = await database.getAllDoctors();
        let message = '<b>Список докторов:</b>\n';
        doctors.forEach((doc, index) => {
            const statusEmoji = doc.isEnabled ? '🟢' : '🔴';
            message += `${statusEmoji} ${doc.fullName} - ${doc.position}. (<b>ID:</b> <code>${doc._id}</code>)\n`;
        });
        ctx.replyWithHTML(message); // Используем метод replyWithHTML для отправки сообщения с HTML форматированием
    } catch (error) {
        console.error('Ошибка при получении списка докторов:', error);
        ctx.reply('Произошла ошибка при получении списка докторов.');
    }
});


bot.command('toggledoctor', (ctx) => {
    ctx.reply('Введите id доктора:');
    ctx.session.stage = 'awaiting_doctor_id';
});

bot.on('text', async (ctx) => {
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
        case 'awaiting_doctor_id':
            const doctorId = ctx.message.text;
            try {
                const updatedDoctor = await database.toggleDoctorEnabledState(doctorId);
                ctx.reply(`Доктор ${updatedDoctor.fullName} теперь ${updatedDoctor.isEnabled ? 'включен' : 'выключен'}.`);
            } catch (error) {
                console.error('Ошибка при обновлении статуса доктора:', error);
                ctx.reply('Произошла ошибка при обновлении статуса доктора.');
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