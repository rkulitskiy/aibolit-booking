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

                const currentSlots = await database.getDoctorTimeSlots(doctor._id) || [];

                if (currentSlots.length > 0) {
                    const slotsToNotify = newSlots.filter(newSlot => !currentSlots.some(currentSlot => currentSlot.id === newSlot.id));

                    if (slotsToNotify.length > 0) {
                        for (const slot of slotsToNotify) {
                            notifyUsersAboutNewSlot(doctor, slot);
                        }
                        await database.updateDoctorTimeSlots(doctor._id, newSlots);
                        console.log(`Time slots updated with new slots for doctor ${doctor.fullName}`);
                    }
                } else {
                    await database.updateDoctorTimeSlots(doctor._id, newSlots);
                    console.log(`Time slots saved for new doctor ${doctor.fullName}`);
                }
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
