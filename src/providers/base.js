const moment = require('moment');

class BaseProvider {
    constructor(name, config) {
        this.name = name;
        this.config = config;
    }

    async getDoctorSlots(doctor, dateStart, dateEnd) {
        throw new Error('getDoctorSlots method must be implemented');
    }

    formatDate(date) {
        return moment(date).format('YYYY-MM-DD');
    }

    formatDateTime(dateTime) {
        return moment(dateTime).format('YYYY-MM-DD HH:mm:ss');
    }

    log(message) {
        console.log(`[${this.name}] ${message}`);
    }

    logError(message, error) {
        console.error(`[${this.name}] ${message}:`, error);
    }
}

module.exports = BaseProvider; 