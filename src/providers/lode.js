const BaseProvider = require('./base');
const axios = require('axios');
const moment = require('moment');

class LodeProvider extends BaseProvider {
    constructor() {
        super('ЛОДЭ', {
            baseUrl: 'https://z-api-lode.vot.by'
        });
    }

    async getDoctorSlots(doctor, dateStart, dateEnd) {
        try {
            if (!doctor.workerId) {
                this.logError(`Doctor ${doctor.fullName} has no workerId`, new Error('No workerId'));
                return [];
            }

            const endDateFormatted = moment(dateEnd).format('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
            const url = `${this.config.baseUrl}/getTicketsByWorker`;
            
            const response = await axios.get(url, {
                params: {
                    workerId: doctor.workerId,
                    lastData: endDateFormatted
                },
                headers: {
                    'Accept': '*/*',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Cache-Control': 'no-cache',
                    'Origin': 'https://www.lode.by',
                    'Referer': 'https://www.lode.by/',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
                }
            });

            if (response.data && Array.isArray(response.data)) {
                const startTime = new Date(dateStart).getTime();
                const endTime = new Date(dateEnd).getTime();
                
                const filteredSlots = response.data.filter(slot => {
                    const slotTime = new Date(slot.start).getTime();
                    return slotTime >= startTime && slotTime <= endTime;
                });

                const normalizedSlots = filteredSlots.map(slot => ({
                    id: slot.id.toString(),
                    start: slot.start,
                    end: null,
                    date: slot.date,
                    time: slot.time,
                    worker_id: slot.worker_id,
                    room_id: slot.room_id,
                    spec_id: slot.spec_id,
                    available: true
                }));

                this.log(`Retrieved ${normalizedSlots.length} real slots for doctor ${doctor.fullName} (workerId: ${doctor.workerId})`);
                return normalizedSlots;
            }
            
            this.log(`No slots found for doctor ${doctor.fullName} (workerId: ${doctor.workerId})`);
            return [];
        } catch (error) {
            this.logError(`Error getting slots for doctor ${doctor.fullName} (workerId: ${doctor.workerId})`, error);
            return [];
        }
    }


}

module.exports = LodeProvider; 