const { Telegraf, session, Markup } = require('telegraf');
const database = require('./database');
const eventBus = require('./eventBus');
const moment = require('moment');
const providersManager = require('./providers/manager');

const bot = new Telegraf(process.env.BOT_TOKEN);

function isDatabaseAvailable() {
    return true;
}

bot.use(session());

bot.use((ctx, next) => {
    if (!ctx.session) {
        ctx.session = {};
    }
    return next();
});

bot.start(async (ctx) => {
    try {
        const providers = providersManager.getProviderNames().join(', ');
        let welcomeMessage = `Привет! Я бот для записи к докторам из разных медицинских центров.\n\n🏥 Доступные центры: ${providers}\n\n`;
        
        if (isDatabaseAvailable()) {
            const user = {
                id: ctx.from.id,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name,
                username: ctx.from.username,
            };
            
            await database.addUser(user);
            welcomeMessage += 'Вы успешно зарегистрированы.\n\n';
        } else {
            welcomeMessage += '🧪 Режим тестирования (без сохранения пользователей)\n\n';
        }
        
        welcomeMessage += 'Используйте /help для просмотра доступных команд.';
        ctx.reply(welcomeMessage);
    } catch (error) {
        console.error('Ошибка при старте бота:', error);
        ctx.reply('Добро пожаловать! Используйте /help для просмотра команд.');
    }
});

bot.command('help', (ctx) => {
    const helpMessage = `
🏥 <b>Доступные команды:</b>

📋 <b>Просмотр:</b>
/showdoctors - Показать всех врачей
/slots - Посмотреть расписание врача

⚕️ <b>Управление врачами Aibolit.md:</b>
/adddoctor - Добавить врача Aibolit.md

🏥 <b>Управление врачами ЛОДЭ:</b>
/addlodedoctor - Добавить врача ЛОДЭ

🔧 <b>Управление:</b>
/toggledoctor - Включить/выключить врача
/help - Эта справка
    `;
    ctx.replyWithHTML(helpMessage);
});



bot.command('adddoctor', (ctx) => {
    if (!ctx.session) {
        ctx.session = {};
    }
    
    ctx.reply('Введите assignmentId доктора (Aibolit.md):');
    ctx.session.stage = 'awaiting_assignmentId';
    ctx.session.provider = 'aibolit';
});

bot.command('addlodedoctor', (ctx) => {
    if (!ctx.session) {
        ctx.session = {};
    }
    
    ctx.reply('Введите workerId врача ЛОДЭ:');
    ctx.session.stage = 'awaiting_workerId';
    ctx.session.provider = 'lode';
});

bot.command('showdoctors', async (ctx) => {
    try {
        const doctors = await database.getAllDoctors();
        let message = '<b>📋 Список докторов:</b>\n\n';
        
        const aibolitDoctors = doctors.filter(doc => doc.provider === 'aibolit');
        const lodeDoctors = doctors.filter(doc => doc.provider === 'lode');
        
        if (aibolitDoctors.length > 0) {
            message += '<b>⚕️ Aibolit.md:</b>\n';
            aibolitDoctors.forEach((doc, index) => {
                const statusEmoji = doc.isEnabled ? '🟢' : '🔴';
                message += `${statusEmoji} ${doc.fullName} - ${doc.position}\n`;
            });
            message += '\n';
        }
        
        if (lodeDoctors.length > 0) {
            message += '<b>🏥 ЛОДЭ:</b>\n';
            lodeDoctors.forEach((doc, index) => {
                const statusEmoji = doc.isEnabled ? '🟢' : '🔴';
                message += `${statusEmoji} ${doc.fullName} - ${doc.position}\n`;
                if (doc.center) {
                    message += `   📍 ${doc.center}\n`;
                }
            });
        }
        
        if (doctors.length === 0) {
            message += 'Врачи не найдены.';
        }
        
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

        const aibolitCount = doctors.filter(doc => doc.provider === 'aibolit').length;
        const lodeCount = doctors.filter(doc => doc.provider === 'lode').length;

        const buttons = [];
        
        if (aibolitCount > 0) {
            buttons.push(Markup.button.callback(`⚕️ Aibolit.md (${aibolitCount})`, 'toggle_provider_aibolit'));
        }
        
        if (lodeCount > 0) {
            buttons.push(Markup.button.callback(`🏥 ЛОДЭ (${lodeCount})`, 'toggle_provider_lode'));
        }

        if (buttons.length === 0) {
            return ctx.reply('В базе данных нет докторов.');
        }

        const inlineKeyboard = Markup.inlineKeyboard(buttons, {columns: 1});
        await ctx.reply('Выберите медицинский центр:', inlineKeyboard);
    } catch (error) {
        console.error('Ошибка при получении списка докторов:', error);
        ctx.reply('Произошла ошибка при попытке получить список докторов.');
    }
});

bot.action(/^toggle_provider_(.+)/, async (ctx) => {
    const provider = ctx.match[1];
    
    try {
        const doctors = await database.getDoctorsByProvider(provider);
        if (doctors.length === 0) {
            return ctx.answerCbQuery(`В базе данных нет врачей для ${provider}`);
        }

        const providerName = provider === 'aibolit' ? 'Aibolit.md' : 'ЛОДЭ';
        const buttons = doctors.map(doctor =>
            Markup.button.callback(`${doctor.isEnabled ? '🟢' : '🔴'} ${doctor.fullName}`, `toggle_${doctor._id.toString()}`)
        );

        const inlineKeyboard = Markup.inlineKeyboard(buttons, {columns: 1});
        await ctx.editMessageText(`Выберите врача для изменения статуса (${providerName}):`, inlineKeyboard);
        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Ошибка при получении списка врачей:', error);
        ctx.answerCbQuery('Произошла ошибка при получении списка врачей');
    }
});

bot.action(/^toggle_(.+)/, async (ctx) => {
    const doctorId = ctx.match[1];
    
    try {
        const doctor = await database.findDoctorById(doctorId);
        if (!doctor) {
            return ctx.answerCbQuery('Доктор не найден');
        }

        const newStatus = !doctor.isEnabled;
        await database.updateDoctorStatus(doctorId, newStatus);
        
        const statusText = newStatus ? 'включен' : 'выключен';
        await ctx.answerCbQuery(`Доктор ${doctor.fullName} ${statusText}`);
        
        const doctors = await database.getDoctorsByProvider(doctor.provider);
        const providerName = doctor.provider === 'aibolit' ? 'Aibolit.md' : 'ЛОДЭ';
        const buttons = doctors.map(doc =>
            Markup.button.callback(`${doc.isEnabled ? '🟢' : '🔴'} ${doc.fullName}`, `toggle_${doc._id.toString()}`)
        );
        const inlineKeyboard = Markup.inlineKeyboard(buttons, {columns: 1});
        
        await ctx.editMessageText(`Выберите врача для изменения статуса (${providerName}):`, inlineKeyboard);
    } catch (error) {
        console.error('Ошибка при изменении статуса доктора:', error);
        ctx.answerCbQuery('Произошла ошибка при изменении статуса');
    }
});

bot.command('slots', async (ctx) => {
    try {
        const doctors = await database.getAllDoctors();
        if (doctors.length === 0) {
            return ctx.reply('В базе данных нет докторов.');
        }

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
        ctx.session = {};
    }

    if (!ctx.session.stage) {
        return;
    }

    switch (ctx.session.stage) {
        case 'awaiting_assignmentId':
            ctx.session.doctor = { 
                assignmentId: ctx.message.text,
                provider: 'aibolit'
            };
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

                eventBus.emit('update-schedule');

                ctx.reply(`✅ Врач ${ctx.session.doctor.fullName} (Aibolit.md) успешно добавлен`);
            } catch (error) {
                console.error('Ошибка при добавлении врача Aibolit.md:', error);
                ctx.reply('Произошла ошибка при добавлении врача.');
            }
            ctx.session.stage = undefined;
            break;

        case 'awaiting_workerId':
            const workerId = parseInt(ctx.message.text);
            if (isNaN(workerId)) {
                return ctx.reply('❌ Пожалуйста, введите корректный числовой workerId');
            }
            
            ctx.session.doctor = { 
                workerId: workerId,
                provider: 'lode'
            };
            
            ctx.reply('Введите полное имя врача ЛОДЭ:');
            ctx.session.stage = 'awaiting_lode_fullName';
            break;
        case 'awaiting_lode_fullName':
            ctx.session.doctor.fullName = ctx.message.text;
            ctx.reply('Введите специализацию врача:');
            ctx.session.stage = 'awaiting_lode_position';
            break;
        case 'awaiting_lode_position':
            ctx.session.doctor.position = ctx.message.text;
            ctx.reply('Введите адрес медцентра (например: Минск, пр. Независимости, 58А):');
            ctx.session.stage = 'awaiting_lode_center';
            break;
        case 'awaiting_lode_center':
            ctx.session.doctor.center = ctx.message.text;
            ctx.session.doctor.isEnabled = true;
            try {
                await database.addDoctor(ctx.session.doctor);
                eventBus.emit('update-schedule');
                ctx.reply(`✅ Врач ${ctx.session.doctor.fullName} (ЛОДЭ, workerId: ${ctx.session.doctor.workerId}) успешно добавлен\n📍 ${ctx.session.doctor.center}`);
            } catch (error) {
                console.error('Ошибка при добавлении врача ЛОДЭ:', error);
                ctx.reply('Произошла ошибка при добавлении врача.');
            }
            ctx.session.stage = undefined;
            break;
    }
});

async function setupBotCommands() {
    const commands = [
        { command: 'start', description: 'Запустить бота' },
        { command: 'help', description: 'Показать все команды' },
        { command: 'showdoctors', description: 'Показать всех врачей' },
        { command: 'slots', description: 'Посмотреть расписание врача' },
        { command: 'adddoctor', description: 'Добавить врача Aibolit.md' },
        { command: 'addlodedoctor', description: 'Добавить врача ЛОДЭ' },
        { command: 'toggledoctor', description: 'Включить/выключить врача' }
    ];

    try {
        await bot.telegram.setMyCommands(commands);
        console.log('✅ Команды бота обновлены');
        console.log('📋 Доступные команды:', commands.map(cmd => `/${cmd.command}`).join(', '));
    } catch (error) {
        console.error('❌ Ошибка при установке команд:', error);
    }
}

async function launchBot() {
    await bot.launch();
    console.log('🤖 Telegram bot launched');
    await setupBotCommands();
}

eventBus.on('notifyUser', (data) => {
    bot.telegram.sendMessage(data.userId, data.message, { parse_mode: 'HTML' }).catch(error => {
        console.error(`Error sending notification to user ${data.userId}:`, error);
    });
});

module.exports = { launchBot };
