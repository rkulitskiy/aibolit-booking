require('dotenv').config();
const database = require('./database');
const { launchBot } = require('./bot'); // Импортируем функцию запуска бота
const scheduler = require('./scheduler');

async function startApp() {
    try {
        await database.connect(); // Подключаемся к MongoDB
        console.log('Connected to MongoDB successfully');

        await launchBot(); // Запускаем Telegram бота
        // Планировщик задач уже настроен в scheduler.js и запустится автоматически
        require('./scheduler');
    } catch (error) {
        console.error('Failed to start the application:', error);
    }
}

startApp();
