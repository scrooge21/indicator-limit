import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import * as h from '../src/services/history.service.js';

const sample = (symbol = 'BTCUSDT', bidUSD = 1) => ({ symbol, price: 100, bidUSD, askUSD: 2, imbalance: bidUSD / 2 });
const fakeStore = (over = {}) => ({ name: 'mongodb', added: [], async add(d) { this.added.push(d); }, async query() { return []; }, async prune() { return 7; }, ...over });

beforeEach(() => { h.resetHistoryState(); env.historyMinIntervalMs = 5000; env.watchMaxSymbols = 10; env.watchTtlMs = 86400000; });

test('троттлинг: чаще интервала запись пропускается, по истечении — выполняется', async () => {
  assert.equal(await h.recordSample(sample(), 1000), true);
  assert.equal(await h.recordSample(sample(), 3000), false);
  assert.equal(await h.recordSample(sample(), 6000), true);
  assert.equal((await h.getHistory({ symbol: 'BTCUSDT', bucket: 0, limit: 100 })).rows.length, 2);
});
test('троттлинг независим для разных символов', async () => {
  assert.equal(await h.recordSample(sample('BTCUSDT'), 1000), true);
  assert.equal(await h.recordSample(sample('ETHUSDT'), 1001), true);
});
test('без БД история читается из памяти', async () => {
  await h.recordSample(sample(), 1000);
  const { source, rows } = await h.getHistory({ symbol: 'BTCUSDT', bucket: 0, limit: 10 });
  assert.equal(source, 'memory'); assert.equal(rows.length, 1);
});
test('с БД: запись идёт и в память, и в БД; чтение — из БД', async () => {
  const store = fakeStore({ async query() { return [{ bidUSD: 42 }]; } });
  h.attachPersistentStore(store, () => true);
  await h.recordSample(sample(), 1000);
  await new Promise(r => setImmediate(r));
  assert.equal(store.added.length, 1);
  const res = await h.getHistory({ symbol: 'BTCUSDT', bucket: 0, limit: 10 });
  assert.equal(res.source, 'mongodb'); assert.equal(res.rows[0].bidUSD, 42);
});
test('БД пуста или недоступна → фолбэк на память', async () => {
  await h.recordSample(sample(), 1000);
  h.attachPersistentStore(fakeStore(), () => true); // пустой ответ
  assert.equal((await h.getHistory({ symbol: 'BTCUSDT', limit: 10 })).source, 'memory');
  h.attachPersistentStore(fakeStore({ async query() { throw new Error('down'); } }), () => true);
  const quiet = console.error; console.error = () => {};
  try { assert.equal((await h.getHistory({ symbol: 'BTCUSDT', limit: 10 })).rows.length, 1); } finally { console.error = quiet; }
  h.attachPersistentStore(fakeStore(), () => false); // не подключена
  assert.equal((await h.getHistory({ symbol: 'BTCUSDT', limit: 10 })).source, 'memory');
});
test('сбой записи в БД не ломает запись в память', async () => {
  h.attachPersistentStore(fakeStore({ async add() { throw new Error('quota exceeded'); } }), () => true);
  const quiet = console.error; console.error = () => {};
  try { assert.equal(await h.recordSample(sample(), 1000), true); await new Promise(r => setImmediate(r)); } finally { console.error = quiet; }
  assert.equal((await h.getHistory({ symbol: 'BTCUSDT', limit: 10 })).rows.length, 1);
});
test('наблюдаемые пары: закреплённые всегда, просмотренные добавляются, лишние вытесняются', () => {
  assert.deepEqual(h.getTrackedSymbols(), h.PINNED_SYMBOLS);
  env.watchMaxSymbols = 2;
  h.watchSymbol('AAAUSDT', 1); h.watchSymbol('BBBUSDT', 2); h.watchSymbol('CCCUSDT', 3); h.watchSymbol('BTCUSDT', 4);
  assert.deepEqual(h.getTrackedSymbols(3), [...h.PINNED_SYMBOLS, 'BBBUSDT', 'CCCUSDT']);
});
test('наблюдаемая пара забывается после TTL', () => {
  env.watchTtlMs = 1000; h.watchSymbol('AAAUSDT', 0);
  assert.ok(h.getTrackedSymbols(500).includes('AAAUSDT'));
  assert.ok(!h.getTrackedSymbols(2000).includes('AAAUSDT'));
});
test('pruneHistory: делегирует БД, без БД возвращает 0', async () => {
  assert.equal(await h.pruneHistory(), 0);
  h.attachPersistentStore(fakeStore(), () => true);
  assert.equal(await h.pruneHistory(), 7);
});
test('historyStats отражает режим хранения', async () => {
  await h.recordSample(sample(), 1000);
  let s = await h.historyStats(); assert.equal(s.store, 'memory'); assert.equal(s.persistent, false); assert.equal(s.memorySamples, 1);
  h.attachPersistentStore(fakeStore(), () => true);
  s = await h.historyStats(); assert.equal(s.store, 'mongodb'); assert.equal(s.persistent, true);
});
