require('dotenv').config();
const database = require('./database');
const { launchBot } = require('./bot');
const scheduler = require('./scheduler');

let retryCount = 0;
const MAX_RETRIES = 10;
const RETRY_DELAY = 30000; // 30 секунд

async function startApp() {
    try {
        console.log('🔌 Подключение к MongoDB...');
        await database.connect();

        console.log('🤖 Запускаем Telegram бота...');
        await launchBot();
        console.log('✅ Успешно запустили Telegram бота');
        
        console.log('✅ Приложение успешно запущено!');
        retryCount = 0; // Сбрасываем счетчик при успешном запуске
    } catch (error) {
        console.error('❌ Ошибка при запуске приложения:', error);
        
        // Если ошибка связана с DNS/сетью, ждем и пытаемся снова
        if (error.code === 'ESERVFAIL' || error.code === 'EAI_AGAIN' || error.errno === 'EAI_AGAIN') {
            retryCount++;
            if (retryCount <= MAX_RETRIES) {
                console.log(`🔄 Проблемы с сетью. Повторная попытка ${retryCount}/${MAX_RETRIES} через ${RETRY_DELAY/1000} секунд...`);
                setTimeout(() => {
                    startApp();
                }, RETRY_DELAY);
                return;
            } else {
                console.error(`❌ Превышено максимальное количество попыток подключения (${MAX_RETRIES}). Завершение работы.`);
            }
        }
        
        // Для других ошибок - выходим
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Получен сигнал SIGINT. Завершение работы...');
    try {
        await database.close();
        console.log('✅ База данных отключена');
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка при завершении работы:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Получен сигнал SIGTERM. Завершение работы...');
    try {
        await database.close();
        console.log('✅ База данных отключена');
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка при завершении работы:', error);
        process.exit(1);
    }
});

startApp();
