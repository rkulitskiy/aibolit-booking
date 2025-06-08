const AibolitProvider = require('./aibolit');
const LodeProvider = require('./lode');

class ProvidersManager {
    constructor() {
        this.providers = new Map();
        this.initializeProviders();
    }

    initializeProviders() {
        this.providers.set('aibolit', new AibolitProvider());
        this.providers.set('lode', new LodeProvider());
        
        console.log('🚀 Инициализированы провайдеры: aibolit, lode');
    }

    getProvider(name) {
        return this.providers.get(name);
    }

    getAllProviders() {
        return Array.from(this.providers.values());
    }

    getProviderNames() {
        return Array.from(this.providers.keys());
    }

    async getAllDoctors() {
        const allDoctors = [];
        
        for (const [name, provider] of this.providers) {
            try {
                const doctors = await provider.getDoctors();
                // Добавляем информацию о провайдере к каждому врачу
                const doctorsWithProvider = doctors.map(doctor => ({
                    ...doctor,
                    providerName: name,
                    provider: provider
                }));
                allDoctors.push(...doctorsWithProvider);
            } catch (error) {
                console.error(`Error getting doctors from ${name}:`, error);
            }
        }
        
        return allDoctors;
    }

    async getDoctorsByProvider(providerName) {
        const provider = this.getProvider(providerName);
        if (!provider) {
            throw new Error(`Provider ${providerName} not found`);
        }
        
        const doctors = await provider.getDoctors();
        return doctors.map(doctor => ({
            ...doctor,
            providerName,
            provider
        }));
    }

    async searchDoctors(query, providerName = null) {
        const results = [];
        const providers = providerName ? [this.getProvider(providerName)] : this.getAllProviders();
        
        for (const provider of providers) {
            if (!provider) continue;
            
            try {
                const doctors = await provider.getDoctors();
                const matchingDoctors = doctors.filter(doctor => 
                    doctor.fullName.toLowerCase().includes(query.toLowerCase()) ||
                    doctor.position.toLowerCase().includes(query.toLowerCase()) ||
                    (doctor.speciality && doctor.speciality.toLowerCase().includes(query.toLowerCase()))
                );
                
                const doctorsWithProvider = matchingDoctors.map(doctor => ({
                    ...doctor,
                    providerName: provider.name,
                    provider
                }));
                
                results.push(...doctorsWithProvider);
            } catch (error) {
                console.error(`Error searching doctors in ${provider.name}:`, error);
            }
        }
        
        return results;
    }

    async getDoctorSlots(doctor, dateStart, dateEnd) {
        if (!doctor.provider) {
            throw new Error('Doctor provider not specified');
        }
        
        return await doctor.provider.getDoctorSlots(doctor, dateStart, dateEnd);
    }

    async bookAppointment(doctor, slot, patientData) {
        if (!doctor.provider) {
            throw new Error('Doctor provider not specified');
        }
        
        return await doctor.provider.bookAppointment(doctor, slot, patientData);
    }

    // Статистические методы
    getProvidersStats() {
        const stats = {};
        for (const [name, provider] of this.providers) {
            stats[name] = {
                name: provider.name,
                active: true,
                // Можно добавить дополнительные метрики
            };
        }
        return stats;
    }
}

// Экспортируем синглтон
module.exports = new ProvidersManager(); 