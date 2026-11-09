import { History } from '../models/history.model.js';

const fields = { _id: 0, timestamp: 1, symbol: 1, price: 1, bidUSD: 1, askUSD: 1, imbalance: 1 };

export class MongoHistoryStore {
  name = 'mongodb';
  constructor({ maxDocs = 400000 } = {}) { this.maxDocs = maxDocs; }

  async add(sample) { await History.create(sample); }

  async query({ symbol, since = null, bucket = 0, limit = 2000 }) {
    const match = { symbol };
    if (since) match.timestamp = { $gte: since };
    if (bucket > 0) {
      const size = bucket * 1000;
      return History.aggregate([
        { $match: match }, { $sort: { timestamp: 1 } },
        { $group: {
          _id: { $subtract: [{ $toLong: '$timestamp' }, { $mod: [{ $toLong: '$timestamp' }, size] }] },
          price: { $last: '$price' }, bidUSD: { $last: '$bidUSD' }, askUSD: { $last: '$askUSD' }, imbalance: { $last: '$imbalance' },
        } },
        { $sort: { _id: -1 } }, { $limit: limit }, { $sort: { _id: 1 } },
        { $project: { _id: 0, timestamp: { $toDate: '$_id' }, symbol: { $literal: symbol }, price: 1, bidUSD: 1, askUSD: 1, imbalance: 1 } },
      ]).allowDiskUse(true);
    }
    const rows = await History.find(match, fields).sort({ timestamp: -1 }).limit(limit).lean();
    return rows.reverse();
  }

  async count() { return History.estimatedDocumentCount(); }

  /** Удаляет самые старые записи сверх лимита, чтобы бесплатная БД не переполнялась. */
  async prune() {
    const excess = (await this.count()) - this.maxDocs;
    if (excess <= 0) return 0;
    const ids = await History.find({}, { _id: 1 }).sort({ timestamp: 1 }).limit(Math.min(excess, 50000)).lean();
    const result = await History.deleteMany({ _id: { $in: ids.map(d => d._id) } });
    return result.deletedCount || 0;
  }
}
