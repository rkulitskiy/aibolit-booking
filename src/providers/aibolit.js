const BaseProvider = require('./base');
const axios = require('axios');

class AibolitProvider extends BaseProvider {
    constructor() {
        super('Aibolit.md', {
            baseUrl: 'https://my2.aibolit.md/api/v2/my'
        });
    }

    async getDoctorSlots(doctor, dateStart, dateEnd) {
        try {
            const response = await axios.get(`${this.config.baseUrl}/providers/timetables`, {
                params: {
                    assignmentId: doctor.assignmentId,
                    dateStart: this.formatDate(dateStart),
                    dateEnd: this.formatDate(dateEnd),
                    physicianId: doctor.physicianId
                }
            });

            if (response.data && response.data[0] && response.data[0].timetable) {
                const slots = response.data[0].timetable;
                slots.sort((a, b) => new Date(a.start) - new Date(b.start));
                return slots;
            }
            
            return [];
        } catch (error) {
            this.logError(`Error getting slots for doctor ${doctor.fullName}`, error);
            return [];
        }
    }


}

module.exports = AibolitProvider; 