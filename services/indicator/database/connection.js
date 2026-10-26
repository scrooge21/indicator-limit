// Подключение сервиса «Индикатор и история» к MongoDB.
// Если INDICATOR_DB не задана, используется база из MONGODB_URI (как в монолите, данные сохраняются).
import { connectMongo } from '../../../shared/mongo.js';

export const connectDatabase = () => connectMongo('indicator', process.env.INDICATOR_DB || undefined);
