// Ручная запись POST /api/history: защита ключом, валидация, запись в память/БД, порядок точек, сбой БД.
// Настоящий Express; MongoDB подменена фейковым хранилищем, ключ задаётся через env.adminApiKey.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { attachPersistentStore, resetHistoryState, recordSample } from '../src/services/history.service.js';
import { parseHistorySample } from '../src/utils/validation.js';
import { installMexcMock } from './helpers/mexc-mock.js';
import { startServer } from './helpers/server.js';

const KEY = 'test-secret-key';
let srv, mock;
before(async () => { mock = installMexcMock(); srv = await startServer(); });
after(async () => { await srv.close(); mock.restore(); });
beforeEach(() => { resetHistoryState(); env.adminApiKey = KEY; env.historyMinIntervalMs = 5000; });

const post = (body, headers = { 'x-api-key': KEY }, raw = false) => fetch(srv.base + '/api/history', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw ? body : JSON.stringify(body),
});
const history = async (q = 'symbol=BTCUSDT') => (await fetch(`${srv.base}/api/history?${q}`)).json();
const valid = { symbol: 'btcusdt', price: 100, bidUSD: 300, askUSD: 150 };

// ---------- защита ----------
test('ключ не задан на сервере → 403, ничего не пишется', async () => {
  env.adminApiKey = '';
  const r = await post(valid); assert.equal(r.status, 403); assert.match((await r.json()).error, /ADMIN_API_KEY/);
  assert.deepEqual(await history(), []);
});
test('нет ключа или неверный ключ → 401, ничего не пишется, ключ не утекает в ответ', async () => {
  for (const headers of [{}, { 'x-api-key': 'wrong' }, { 'x-api-key': KEY + 'x' }, { 'x-api-key': '' }]) {
    const r = await post(valid, headers); const text = await r.text();
    assert.equal(r.status, 401, JSON.stringify(headers)); assert.ok(!text.includes(KEY));
  }
  assert.deepEqual(await history(), []);
});
test('защита срабатывает раньше валидации: без ключа плохое тело не раскрывает детали', async () => {
  assert.equal((await post({ nonsense: true }, {})).status, 401);
});

// ---------- успешная запись ----------
test('верный ключ → 201, точка видна в GET /api/history, imbalance считается сам', async () => {
  const r = await post(valid); const b = await r.json();
  assert.equal(r.status, 201); assert.equal(b.stored, 'memory'); assert.equal(r.headers.get('x-history-source'), 'memory');
  assert.equal(b.point.symbol, 'BTCUSDT'); assert.equal(b.point.imbalance, 2);
  const rows = await history(); assert.equal(rows.length, 1);
  assert.equal(rows[0].bidUSD, 300); assert.equal(rows[0].askUSD, 150); assert.equal(rows[0].price, 100);
});
test('askUSD = 0 → imbalance 0 (без деления на ноль); явный imbalance имеет приоритет', async () => {
  assert.equal((await (await post({ symbol: 'ETHUSDT', price: 1, bidUSD: 5 })).json()).point.imbalance, 0);
  assert.equal((await (await post({ ...valid, imbalance: 9.5 })).json()).point.imbalance, 9.5);
});
test('троттлинг не применяется: подряд несколько ручных точек и автоматическая точка', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await post(valid)).status, 201);
  assert.equal(await recordSample({ symbol: 'BTCUSDT', price: 1, bidUSD: 1, askUSD: 1, imbalance: 1 }), true, 'ручная запись не должна занимать «окно» троттлинга');
  assert.equal((await history()).length, 4);
});
test('timestamp «задним числом» встаёт в правильное место по времени', async () => {
  const now = Date.now(); const iso = (ms) => new Date(now - ms).toISOString();
  await post({ ...valid, bidUSD: 3, timestamp: iso(1000) });
  await post({ ...valid, bidUSD: 1, timestamp: iso(3 * 3600_000) });
  await post({ ...valid, bidUSD: 2, timestamp: iso(60_000) });
  assert.deepEqual((await history()).map(r => r.bidUSD), [1, 2, 3]);
});
test('запись в одну пару не попадает в историю другой', async () => {
  await post({ ...valid, symbol: 'SOLUSDT' });
  assert.equal((await history('symbol=BTCUSDT')).length, 0); assert.equal((await history('symbol=SOLUSDT')).length, 1);
});

// ---------- MongoDB ----------
test('с подключённой БД: запись идёт в БД и в память, источник — mongodb', async () => {
  const added = [];
  attachPersistentStore({ name: 'mongodb', async add(d) { added.push(d); }, async query() { return []; }, async prune() { return 0; } }, () => true);
  const r = await post(valid); const b = await r.json();
  assert.equal(r.status, 201); assert.equal(b.stored, 'mongodb'); assert.equal(r.headers.get('x-history-source'), 'mongodb');
  assert.equal(added.length, 1); assert.equal(added[0].symbol, 'BTCUSDT'); assert.ok(added[0].timestamp instanceof Date);
});
test('сбой БД → 502 без утечки деталей, и точка НЕ записывается «молча» в одну память', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    attachPersistentStore({ name: 'mongodb', async add() { throw new Error('secret connection string mongodb+srv://u:pw@host'); }, async query() { return []; }, async prune() { return 0; } }, () => true);
    const r = await post(valid); const text = await r.text();
    assert.equal(r.status, 502); assert.ok(!text.includes('mongodb+srv') && !text.includes('pw@'));
  } finally { console.error = quiet; }
  resetHistoryState(); assert.deepEqual(await history(), []);
});
test('БД подключена, но не готова → точка сохраняется в память (source memory)', async () => {
  attachPersistentStore({ name: 'mongodb', async add() { throw new Error('must not be called'); }, async query() { return []; }, async prune() { return 0; } }, () => false);
  const b = await (await post(valid)).json(); assert.equal(b.stored, 'memory');
});

// ---------- валидация (через HTTP) ----------
test('некорректное тело → 400 с понятным текстом, ничего не записано', async () => {
  const cases = [
    {}, { price: 1 }, { symbol: 'BTCUSDT' }, { symbol: '', price: 1 }, { symbol: 'BTC/USDT', price: 1 }, { symbol: 123, price: 1 },
    { symbol: 'BTCUSDT', price: 0 }, { symbol: 'BTCUSDT', price: -5 }, { symbol: 'BTCUSDT', price: '100' }, { symbol: 'BTCUSDT', price: null },
    { symbol: 'BTCUSDT', price: 1, bidUSD: -1 }, { symbol: 'BTCUSDT', price: 1, askUSD: '5' }, { symbol: 'BTCUSDT', price: 1, imbalance: -2 },
    { symbol: 'BTCUSDT', price: 1, timestamp: 'вчера' }, { symbol: 'BTCUSDT', price: 1, timestamp: 1700000000 },
    { symbol: 'BTCUSDT', price: 1, timestamp: new Date(Date.now() + 3600_000).toISOString() },
    { symbol: 'BTCUSDT', price: 1, timestamp: new Date(Date.now() - 30 * 86400_000).toISOString() },
    [], 'text', 42,
  ];
  for (const body of cases) {
    const r = await post(body); const b = await r.json();
    assert.equal(r.status, 400, JSON.stringify(body)); assert.ok(typeof b.error === 'string' && b.error.length > 3);
  }
  assert.deepEqual(await history(), []);
});
test('некорректный JSON и пустое тело → 4xx, сервер жив', async () => {
  assert.ok((await post('{bad', undefined, true)).status >= 400);
  const empty = await fetch(srv.base + '/api/history', { method: 'POST', headers: { 'x-api-key': KEY } });
  assert.equal(empty.status, 400);
  assert.equal((await fetch(srv.base + '/api/health')).status, 200);
});

// ---------- parseHistorySample (юнит) ----------
test('parseHistorySample: нормализует символ, подставляет текущее время и значения по умолчанию', () => {
  const now = Date.parse('2026-11-09T10:00:00Z');
  const s = parseHistorySample({ symbol: ' ethusdt ', price: 5 }, { now });
  assert.deepEqual(s, { timestamp: new Date(now), symbol: 'ETHUSDT', price: 5, bidUSD: 0, askUSD: 0, imbalance: 0 });
});
test('parseHistorySample: границы timestamp (минута вперёд допустима, срок хранения — граница)', () => {
  const now = Date.parse('2026-11-09T10:00:00Z'); const base = { symbol: 'BTCUSDT', price: 1 }; const maxAgeMs = 3600_000;
  assert.doesNotThrow(() => parseHistorySample({ ...base, timestamp: new Date(now + 30_000).toISOString() }, { now, maxAgeMs }));
  assert.throws(() => parseHistorySample({ ...base, timestamp: new Date(now + 61_000).toISOString() }, { now, maxAgeMs }), { status: 400 });
  assert.doesNotThrow(() => parseHistorySample({ ...base, timestamp: new Date(now - maxAgeMs).toISOString() }, { now, maxAgeMs }));
  assert.throws(() => parseHistorySample({ ...base, timestamp: new Date(now - maxAgeMs - 1000).toISOString() }, { now, maxAgeMs }), { status: 400 });
});
