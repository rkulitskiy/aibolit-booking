const axios = require('axios');
const database = require('./database');
const cron = require('node-cron');
const moment = require('moment');
const eventBus = require('./eventBus');

async function updateDoctorsTimeSlots() {
    const doctors = await database.getEnabledDoctors();
    const dateStart = moment().format('YYYY-MM-DD');
    const dateEnd = moment().add(1, 'month').format('YYYY-MM-DD');

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

                // Получаем текущие слоты из базы данных
                const currentSlots = await database.getDoctorTimeSlots(doctor._id) || [];

                // Обновляем все слоты в базе данных
                await database.updateDoctorTimeSlots(doctor._id, newSlots);

                // Определяем новые слоты для уведомлений, сравнивая со слотами до обновления
                const slotsToNotify = newSlots.filter(newSlot => !currentSlots.some(currentSlot => newSlot.id === currentSlot.id));

                // Уведомляем пользователей о новых слотах, которые не были в базе до обновления
                if (slotsToNotify.length > 0) {
                    slotsToNotify.forEach(slot => notifyUsersAboutNewSlot(doctor, slot));
                    console.log(`Notified about new slots for doctor ${doctor.fullName}`);
                }

                console.log(`Time slots updated for doctor ${doctor.fullName}`);
            }
        } catch (error) {
            console.error(`Error updating time slots for doctor ${doctor.fullName}:`, error);
        }
    }
}

function notifyUsersAboutNewSlot(doctor, slot) {
    const formattedDate = moment(slot.start).format('DD.MM.YYYY HH:mm');
    const message = `🕒 Доступен новый слот у доктора ${doctor.fullName} (${doctor.position}): <b>${formattedDate}</b>`;

    database.getAllUsers().then(users => {
        users.forEach(user => {
            eventBus.emit('notifyUser', { userId: user.id, message: message });
        });
    }).catch(error => {
        console.error(`Error notifying users about new slot:`, error);
    });
}

cron.schedule('*/5 * * * *', async () => {
    console.log('Starting task to update doctor schedules:', moment().format('YYYY-MM-DD HH:mm:ss'));
    await updateDoctorsTimeSlots();
});

console.log('Scheduler has been initialized.');

// Подписываемся на событие 'update-schedule'
eventBus.on('update-schedule', updateDoctorsTimeSlots);

module.exports = { updateDoctorsTimeSlots };
