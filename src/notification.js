const { bot } = require('./bot'); // Импортируем экземпляр бота

async function notifyUsersAboutNewSlot(doctor, slot) {
    const users = await database.getAllUsers();
    const formattedDate = moment(slot.start).format('DD.MM.YYYY HH:mm');

    for (const user of users) {
        const message = `🕒 Доступен новый слот у доктора ${doctor.fullName} (${doctor.position}): <b>${formattedDate}</b>`;
        try {
            await bot.telegram.sendMessage(user.id, message, { parse_mode: 'HTML' });
            console.log(`Notification sent to user ${user.id} about a new slot for doctor ${doctor.fullName}`);
        } catch (error) {
            console.error(`Error sending notification to user ${user.id}:`, error);
        }
    }
}

module.exports = { notifyUsersAboutNewSlot };