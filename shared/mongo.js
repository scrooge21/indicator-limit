// Подключение сервиса к MongoDB. Если MONGODB_URI не задан — сервис работает без БД.
import mongoose from 'mongoose';
import { MONGODB_URI } from './config.js';

export async function connectMongo(serviceName, dbName) {
    if (!MONGODB_URI) {
        console.log(`ℹ️  [${serviceName}] MONGODB_URI не задан — работа без хранения данных`);
        return false;
    }
    try {
        await mongoose.connect(MONGODB_URI, dbName ? { dbName } : {});
        console.log(`✅ [${serviceName}] MongoDB подключена${dbName ? ` (база ${dbName})` : ''}`);
        return true;
    } catch (err) {
        console.error(`❌ [${serviceName}] ошибка MongoDB:`, err.message);
        return false;
    }
}

// 1 — соединение установлено
export const dbReady = () => mongoose.connection.readyState === 1;
