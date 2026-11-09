// Хранилища истории без внешних зависимостей. Образец: { timestamp: Date, symbol, price, bidUSD, askUSD, imbalance }.

/**
 * Сжимает отсортированные по времени записи в корзины по bucketSec секунд.
 * В корзине остаётся последняя запись; timestamp = НАЧАЛО корзины (совпадает со временем свечи графика).
 * Возвращает последние `limit` корзин (самые новые), по возрастанию времени.
 */
export function bucketize(samples, bucketSec, limit) {
  if (!bucketSec || bucketSec <= 0) return samples.slice(-limit);
  const size = bucketSec * 1000;
  const buckets = new Map();
  for (const s of samples) {
    const start = Math.floor(s.timestamp.getTime() / size) * size;
    buckets.set(start, { ...s, timestamp: new Date(start) });
  }
  return [...buckets.values()].slice(-limit);
}

export class MemoryHistoryStore {
  name = 'memory';
  constructor({ maxPerSymbol = 20000 } = {}) { this.maxPerSymbol = maxPerSymbol; this.data = new Map(); }

  async add(sample) {
    const list = this.data.get(sample.symbol) || [];
    let i = list.length;
    while (i > 0 && list[i - 1].timestamp > sample.timestamp) i--; // обычно 0 шагов; ручная запись «задним числом» встаёт по времени
    list.splice(i, 0, sample);
    if (list.length > this.maxPerSymbol) list.splice(0, list.length - this.maxPerSymbol);
    this.data.set(sample.symbol, list);
  }

  async query({ symbol, since = null, bucket = 0, limit = 2000 }) {
    let list = this.data.get(symbol) || [];
    if (since) list = list.filter(s => s.timestamp >= since);
    return bucketize(list, bucket, limit).map(({ timestamp, bidUSD, askUSD, imbalance, price, symbol: sym }) => ({ timestamp, symbol: sym, price, bidUSD, askUSD, imbalance }));
  }

  async count() { let n = 0; for (const list of this.data.values()) n += list.length; return n; }
  async prune() { return 0; } // размер ограничен кольцевым буфером
  clear() { this.data.clear(); }
}
