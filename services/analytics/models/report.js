// Коллекция reports — сформированные аналитические отчёты.
import mongoose from 'mongoose';

const metricSchema = new mongoose.Schema({
    mean: Number, min: Number, max: Number, last: Number, std: Number
}, { _id: false });

const forecastInfoSchema = new mongoose.Schema({
    direction: { type: String, enum: ['up', 'down', 'flat'] },
    slope: Number,
    r2: Number
}, { _id: false });

const reportSchema = new mongoose.Schema({
    createdAt: { type: Date, default: Date.now },
    symbol:    { type: String, required: true, uppercase: true },
    hours:     Number,
    bucketSec: Number,
    from:      Date,
    to:        Date,
    points:    Number,
    imbalance: metricSchema,
    bidUSDMean: Number,
    askUSDMean: Number,
    priceChangePct: Number,        // изменение цены от первой до последней точки, %
    shareBuyers:  Number,          // доля времени, когда дисбаланс > 1,2
    shareSellers: Number,          // доля времени, когда дисбаланс < 0,8
    forecast:  forecastInfoSchema,
    summary:   String
}, { versionKey: false });

reportSchema.index({ symbol: 1, createdAt: -1 });

export const Report = mongoose.model('Report', reportSchema);
