import mongoose from 'mongoose';
import { env } from '../config/env.js';

const historySchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  symbol: { type: String, required: true, uppercase: true },
  price: { type: Number, required: true },
  bidUSD: { type: Number, default: 0 },
  askUSD: { type: Number, default: 0 },
  imbalance: { type: Number, default: 0 },
}, { versionKey: false });

// Раньше на timestamp было ДВА индекса ({index:true} и TTL) — это конфликт, и TTL мог не создаваться,
// из-за чего БД росла бесконечно. Теперь: составной индекс под запросы + отдельный TTL-индекс.
historySchema.index({ symbol: 1, timestamp: 1 });
historySchema.index({ timestamp: 1 }, { expireAfterSeconds: env.historyTtlSeconds });
export const History = mongoose.models.History || mongoose.model('History', historySchema);
