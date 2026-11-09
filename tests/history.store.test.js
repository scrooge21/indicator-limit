import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketize, MemoryHistoryStore } from '../src/services/history.store.js';

const S = (sec, bid = 1, symbol = 'BTCUSDT') => ({ timestamp: new Date(sec * 1000), symbol, price: 100, bidUSD: bid, askUSD: 2, imbalance: bid / 2 });

test('bucketize: bucket=0 возвращает последние N записей без агрегации', () => {
  const r = bucketize([S(1), S(2), S(3), S(4)], 0, 2);
  assert.deepEqual(r.map(x => x.timestamp.getTime() / 1000), [3, 4]);
});
test('bucketize: время точки = начало корзины, побеждает последняя запись', () => {
  const r = bucketize([S(61, 1), S(75, 2), S(119, 3), S(121, 4)], 60, 10);
  assert.deepEqual(r.map(x => x.timestamp.getTime() / 1000), [60, 120]);
  assert.deepEqual(r.map(x => x.bidUSD), [3, 4]);
});
test('bucketize: при limit остаются самые НОВЫЕ корзины', () => {
  const r = bucketize([S(0), S(60), S(120), S(180)], 60, 2);
  assert.deepEqual(r.map(x => x.timestamp.getTime() / 1000), [120, 180]);
});

test('MemoryHistoryStore: кольцевой буфер не превышает maxPerSymbol', async () => {
  const store = new MemoryHistoryStore({ maxPerSymbol: 3 });
  for (let i = 0; i < 10; i++) await store.add(S(i, i));
  assert.equal(await store.count(), 3);
  const rows = await store.query({ symbol: 'BTCUSDT' });
  assert.deepEqual(rows.map(r => r.bidUSD), [7, 8, 9]);
});
test('MemoryHistoryStore: символы изолированы, since фильтрует', async () => {
  const store = new MemoryHistoryStore();
  await store.add(S(10, 1)); await store.add(S(20, 2)); await store.add(S(15, 9, 'ETHUSDT'));
  assert.equal((await store.query({ symbol: 'ETHUSDT' })).length, 1);
  const rows = await store.query({ symbol: 'BTCUSDT', since: new Date(15000) });
  assert.deepEqual(rows.map(r => r.bidUSD), [2]);
  assert.deepEqual(await store.query({ symbol: 'NOPE' }), []);
});
test('MemoryHistoryStore: ответ содержит поля индикатора', async () => {
  const store = new MemoryHistoryStore(); await store.add(S(5, 4));
  const [row] = await store.query({ symbol: 'BTCUSDT', bucket: 60 });
  assert.deepEqual(Object.keys(row).sort(), ['askUSD', 'bidUSD', 'imbalance', 'price', 'symbol', 'timestamp']);
});
