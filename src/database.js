const { MongoClient, ObjectId } = require('mongodb');
const eventBus = require('./eventBus');

class Database {
    constructor() {
        this.client = new MongoClient(process.env.MONGODB_URI);
        this.db = null;
    }

    async connect() {
        try {
            await this.client.connect();
            this.db = this.client.db("aibolit-booking");
        } catch (error) {
            console.error("Failed to connect to MongoDB", error);
        }
    }

    async addUser(user) {
        const usersCollection = this.db.collection('users');
        await usersCollection.insertOne(user);
    }

    async addDoctor(doctor) {
        const doctorsCollection = this.db.collection('doctors');
        await doctorsCollection.insertOne(doctor);
    }

    async addTimeSlot(timeSlot) {
        const timeSlotsCollection = this.db.collection('timeSlots');
        await timeSlotsCollection.insertOne(timeSlot);
    }

    async getUserDoctors(userId) {
        const userDoctorsCollection = this.db.collection('userDoctors');
        return userDoctorsCollection.find({ userId }).toArray();
    }

    async addUserDoctor(userDoctor) {
        const userDoctorsCollection = this.db.collection('userDoctors');
        await userDoctorsCollection.insertOne(userDoctor);
    }

    async getAllDoctors() {

        try {
            const doctorsCollection = this.db.collection('doctors');
            return await doctorsCollection.find({}).toArray();
        } catch (error) {
            console.error('Ошибка при получении списка докторов:', error);
            throw error; // Перебрасываем ошибку для обработки на более высоком уровне
        }
    }

    async getEnabledDoctors() {
        try {
            const doctorsCollection = this.db.collection('doctors');
            return await doctorsCollection.find({ isEnabled: true  }).toArray();
        } catch (error) {
            console.error('Ошибка при получении списка докторов:', error);
            throw error; // Перебрасываем ошибку для обработки на более высоком уровне
        }
    }

    async toggleDoctorEnabledState(doctorId) {
        try {
            // Исправление здесь: используем 'new' для создания экземпляра ObjectId
            const docId = new ObjectId(doctorId);
            const doctor = await this.db.collection('doctors').findOne({ _id: docId });
            if (!doctor) {
                throw new Error('Доктор не найден');
            }
            const updated = await this.db.collection('doctors').updateOne(
                { _id: docId },
                { $set: { isEnabled: !doctor.isEnabled } }
            );
            return await this.db.collection('doctors').findOne({ _id: docId });
        } catch (error) {
            console.error('Ошибка при переключении статуса доктора:', error);
            throw error;
        }
    }

    async getDoctorTimeSlots(doctorId) {
        // Преобразуем doctorId к типу ObjectId, если он передан в виде строки
        const id = typeof doctorId === 'string' ? new ObjectId(doctorId) : doctorId;
        const record = await this.db.collection('timeSlots').findOne({ doctorId: id });
        return record ? record.slots : [];
    }

    async updateDoctorTimeSlots(doctorId, newSlots) {
        try {
            const updateResult = await this.db.collection('timeSlots').updateOne(
                { doctorId: doctorId },
                { $set: { slots: newSlots } },
                { upsert: true }
            );

            // Публикация события после успешного обновления слотов
            if(updateResult.modifiedCount > 0 || updateResult.upsertedCount > 0) {
                eventBus.emit('timeSlotsUpdated', { doctorId, newSlots });
                console.log(`Time slots updated for doctor with ID ${doctorId}`);
            }
        } catch (error) {
            console.error(`Error updating time slots for doctor with ID ${doctorId}:`, error);
            throw error;
        }
    }

    async getAllUsers() {
        try {
            return await this.db.collection('users').find({}).toArray();
        } catch (error) {
            console.error('Error getting all users from database:', error);
            throw error; // Выбрасываем ошибку для обработки на более высоком уровне
        }
    }

}

const database = new Database();
module.exports = database;
