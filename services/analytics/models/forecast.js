// Коллекция forecasts — рассчитанные прогнозы (хранятся 7 суток).
import mongoose from 'mongoose';

const forecastSchema = new mongoose.Schema({
    createdAt:    { type: Date, default: Date.now },
    symbol:       { type: String, required: true, uppercase: true },
    target:       { type: String, enum: ['imbalance', 'price', 'bidUSD', 'askUSD'], required: true },
    method:       { type: String, default: 'linear' },
    hours:        Number,        // глубина выборки истории, ч
    bucketSec:    Number,        // шаг ряда, с
    horizon:      Number,        // число прогнозируемых шагов
    sourcePoints: Number,        // число точек, по которым построена модель
    slope:        Number,
    intercept:    Number,
    r2:           Number,
    direction:    { type: String, enum: ['up', 'down', 'flat'] },
    points:       [{ _id: false, t: Date, value: Number }]
}, { versionKey: false });

forecastSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
forecastSchema.index({ symbol: 1, createdAt: -1 });

export const Forecast = mongoose.model('Forecast', forecastSchema);
