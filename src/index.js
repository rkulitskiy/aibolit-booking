require('dotenv').config();
const database = require('./database');
const { launchBot } = require('./bot');
const scheduler = require('./scheduler');

async function startApp() {
    try {
        console.log('🔌 Подключение к MongoDB...');
        await database.connect();
        console.log('✅ Успешно подключились к MongoDB');

        console.log('🤖 Запускаем Telegram бота...');
        await launchBot();
        console.log('✅ Успешно запустили Telegram бота');
        
        console.log('✅ Приложение успешно запущено!');
    } catch (error) {
        console.error('❌ Ошибка при запуске приложения:', error);
        process.exit(1);
    }
}

startApp();
