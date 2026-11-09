// Коллекция histories — единственное постоянное хранилище сервиса «Индикатор и история».
import mongoose from 'mongoose';
import { HISTORY_TTL_SECONDS } from '../../../shared/config.js';

const historySchema = new mongoose.Schema({
    timestamp: { type: Date,   default: Date.now },
    symbol:    { type: String, required: true, uppercase: true, trim: true },
    price:     { type: Number, required: true },
    bidUSD:    { type: Number, required: true, min: 0 },
    askUSD:    { type: Number, required: true, min: 0 },
    imbalance: { type: Number, required: true, min: 0 },
    // новые поля (уточнение структуры данных, ЛР 2)
    depthPct:  { type: Number, default: 5, min: 0.1, max: 50 },          // окно ±d% от цены
    source:    { type: String, enum: ['client', 'logger'], default: 'client' } // кто сделал замер
}, { versionKey: false });

// TTL-индекс по времени: запись удаляется через 7 суток. Он же ускоряет выборки по времени.
// (Отдельный index: true на timestamp убран — он конфликтовал бы с TTL-индексом по тому же ключу.)
historySchema.index({ timestamp: 1 }, { expireAfterSeconds: HISTORY_TTL_SECONDS });
// Составной индекс для запросов «пара + период»
historySchema.index({ symbol: 1, timestamp: 1 });

export const History = mongoose.model('History', historySchema);
