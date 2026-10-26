// Коллекция scan_snapshots — история сканирований (расширение, предложенное в ЛР 1).
import mongoose from 'mongoose';

const rowSchema = new mongoose.Schema({
    symbol:    String,
    price:     Number,
    change:    Number,    // изменение цены за 24 ч, %
    volume:    Number,    // оборот за 24 ч, USDT
    bidUSD:    Number,
    askUSD:    Number,
    imbalance: Number
}, { _id: false });

const scanSnapshotSchema = new mongoose.Schema({
    createdAt: { type: Date, default: Date.now },
    depthPct:  { type: Number, required: true },
    limit:     { type: Number, required: true },
    rows:      [rowSchema]
}, { versionKey: false });

// Снимки хранятся 30 суток
scanSnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const ScanSnapshot = mongoose.model('ScanSnapshot', scanSnapshotSchema, 'scan_snapshots');
