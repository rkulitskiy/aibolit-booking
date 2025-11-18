#!/usr/bin/env node

require('dotenv').config();
const database = require('./src/database');

async function testConnection() {
    console.log('🧪 Тестирование подключения к MongoDB и Telegram API...');
    
    try {
        // Тест MongoDB
        console.log('📊 Тестирование MongoDB...');
        await database.connect();
        console.log('✅ MongoDB подключение успешно');
        
        // Тест получения докторов
        const doctors = await database.getAllDoctors();
        console.log(`📋 Найдено докторов в базе: ${doctors.length}`);
        
        await database.close();
        console.log('✅ MongoDB отключение успешно');
        
    } catch (error) {
        console.error('❌ Ошибка MongoDB:', error.message);
    }
    
    try {
        // Тест Telegram API
        console.log('🤖 Тестирование Telegram API...');
        const { Telegraf } = require('telegraf');
        const bot = new Telegraf(process.env.BOT_TOKEN);
        
        const botInfo = await bot.telegram.getMe();
        console.log(`✅ Telegram API работает. Бот: @${botInfo.username}`);
        
    } catch (error) {
        console.error('❌ Ошибка Telegram API:', error.message);
    }
    
    console.log('🏁 Тестирование завершено');
    process.exit(0);
}

testConnection();
