const { MongoClient, ObjectId } = require('mongodb');
const eventBus = require('./eventBus');
const axios = require('axios');
const moment = require('moment');

class Database {
    constructor() {
        this.client = new MongoClient(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000, // Таймаут подключения 5 сек
            socketTimeoutMS: 45000, // Таймаут сокета 45 сек
            maxPoolSize: 10, // Максимальный размер пула соединений
            retryWrites: true,
            retryReads: true
        });
        this.db = null;
        this.isConnecting = false;
    }

    async connect() {
        if (this.isConnecting) {
            console.log('🔄 Подключение к MongoDB уже в процессе...');
            return;
        }
        
        this.isConnecting = true;
        try {
            await this.client.connect();
            this.db = this.client.db("aibolit-booking");
            console.log('✅ Успешно подключились к MongoDB');
            this.isConnecting = false;
        } catch (error) {
            console.error("Failed to connect to MongoDB", error);
            this.db = null;
            this.isConnecting = false;
            throw error; // Пробрасываем ошибку дальше
        }
    }

    async ensureConnection() {
        if (!this.db && !this.isConnecting) {
            console.log('🔄 Попытка переподключения к MongoDB...');
            try {
                await this.connect();
            } catch (error) {
                console.error('❌ Не удалось переподключиться к MongoDB:', error.message);
                throw error;
            }
        }
    }

    async close() {
        try {
            if (this.client) {
                await this.client.close();
                this.db = null;
            }
        } catch (error) {
            console.error("Error closing MongoDB connection", error);
        }
    }

    async addUser(user) {
        const usersCollection = this.db.collection('users');
        await usersCollection.insertOne(user);
    }

    async addDoctor(doctor) {
        const doctorsCollection = this.db.collection('doctors');
        doctor.createdAt = new Date();
        doctor.provider = doctor.provider || 'aibolit';
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
            throw error;
        }
    }

    async getEnabledDoctors() {
        try {
            const doctorsCollection = this.db.collection('doctors');
            return await doctorsCollection.find({ isEnabled: true  }).toArray();
        } catch (error) {
            console.error('Ошибка при получении списка докторов:', error);
            throw error;
        }
    }

    async getEnabledDoctorsByProvider(provider) {
        try {
            await this.ensureConnection();
            if (!this.db) {
                throw new Error('База данных не подключена');
            }
            const doctorsCollection = this.db.collection('doctors');
            return await doctorsCollection.find({ isEnabled: true, provider: provider }).toArray();
        } catch (error) {
            console.error(`Ошибка при получении списка докторов провайдера ${provider}:`, error);
            throw error;
        }
    }

    async getDoctorsByProvider(provider) {
        try {
            const doctorsCollection = this.db.collection('doctors');
            return await doctorsCollection.find({ provider: provider }).toArray();
        } catch (error) {
            console.error(`Ошибка при получении докторов провайдера ${provider}:`, error);
            throw error;
        }
    }

    async toggleDoctorEnabledState(doctorId) {
        try {
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

            if(updateResult.modifiedCount > 0 || updateResult.upsertedCount > 0) {
                eventBus.emit('timeSlotsUpdated', { doctorId, newSlots });
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
            throw error;
        }
    }

    async findDoctorByLastName(lastName) {
        return await this.db.collection('doctors').findOne({ "fullName": { $regex: lastName, $options: 'i' } });
    }

    async getActualSlotsForDoctor(doctor) {
        const dateStart = moment().format('YYYY-MM-DD');
        const dateEnd = moment().add(14, 'days').format('YYYY-MM-DD');

        const response = await axios.get(`https://my2.aibolit.md/api/v2/my/providers/timetables`, {
            params: {
                assignmentId: doctor.assignmentId,
                dateStart,
                dateEnd,
                physicianId: doctor.physicianId
            }
        });

        return response.data[0].timetable;
    }

    async getDoctorById(doctorId) {
        try {
            const id = typeof doctorId === 'string' ? new ObjectId(doctorId) : doctorId;
            return await this.db.collection('doctors').findOne({_id: id});
        } catch (error) {
            console.error(`Error fetching doctor with ID ${doctorId}:`, error);
            throw error;
        }
    }

    async findDoctorById(doctorId) {
        try {
            const id = typeof doctorId === 'string' ? new ObjectId(doctorId) : doctorId;
            return await this.db.collection('doctors').findOne({_id: id});
        } catch (error) {
            console.error(`Error finding doctor with ID ${doctorId}:`, error);
            throw error;
        }
    }

    async updateDoctorStatus(doctorId, isEnabled) {
        try {
            const id = typeof doctorId === 'string' ? new ObjectId(doctorId) : doctorId;
            const result = await this.db.collection('doctors').updateOne(
                { _id: id },
                { $set: { isEnabled: isEnabled } }
            );
            return result;
        } catch (error) {
            console.error(`Error updating doctor status with ID ${doctorId}:`, error);
            throw error;
        }
    }

}

const database = new Database();
module.exports = database;
