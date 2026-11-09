// Интеграционные тесты REST API: настоящий Express, MEXC подменён фикстурами, БД не нужна (история в памяти).
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { resetHistoryState } from '../src/services/history.service.js';
import { resetSymbolsCache } from '../src/services/market.service.js';
import { installMexcMock, json, EXPECTED_5PCT } from './helpers/mexc-mock.js';
import { startServer } from './helpers/server.js';

let srv, mock;
const get = (p) => fetch(srv.base + p);
before(async () => { mock = installMexcMock(); srv = await startServer(); });
after(async () => { await srv.close(); mock.restore(); });
beforeEach(() => { resetHistoryState(); resetSymbolsCache(); env.historyMinIntervalMs = 5000; });

test('GET /api/health', async () => {
  const r = await get('/api/health'); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.status, 'ok'); assert.equal(b.database, 'disconnected');
  assert.equal(b.history.store, 'memory'); assert.ok(!Number.isNaN(Date.parse(b.timestamp)));
});
test('GET /api/symbols', async () => {
  assert.deepEqual(await (await get('/api/symbols')).json(), ['BTCUSDT', 'ETHUSDT', 'XRPUSDT']);
});
test('GET /api/klines: свечи, валидация symbol и interval', async () => {
  const r = await get('/api/klines?symbol=btcusdt&interval=5m'); const b = await r.json();
  assert.equal(r.status, 200); assert.ok(Array.isArray(b) && b.length === 2);
  assert.ok(mock.calls.some(c => c.includes('/klines') && c.includes('interval=5m') && c.includes('symbol=BTCUSDT')));
  assert.equal((await get('/api/klines?interval=7m')).status, 400);
  assert.equal((await get('/api/klines?symbol=BTC/USDT')).status, 400);
});
test('GET /api/data: цена, ликвидность, стакан; валидация depth', async () => {
  const r = await get('/api/data?symbol=BTCUSDT&depth=5'); const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.price, 100); assert.equal(b.bidUSD, EXPECTED_5PCT.bidUSD);
  assert.ok(b.book.bids.length && b.book.asks.length);
  for (const q of ['depth=0', 'depth=21', 'depth=abc', 'symbol=%24%24']) assert.equal((await get('/api/data?' + q)).status, 400, q);
});
test('GET /api/data: ошибки MEXC → 502/504, внутренняя ошибка → 500 без утечки деталей', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal((await get('/api/data?symbol=NOPEUSDT')).status, 502);
    const bad = await get('/api/data?symbol=BADUSDT');
    assert.equal(bad.status, 500); assert.deepEqual(await bad.json(), { error: 'Internal server error' });
    mock.restore(); mock = installMexcMock({ '/api/v3/depth': () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
    assert.equal((await get('/api/data?symbol=BTCUSDT')).status, 504);
  } finally { console.error = quiet; mock.restore(); mock = installMexcMock(); }
});
test('GET /api/history: пусто → после /api/data появляется точка индикатора (без БД, из памяти)', async () => {
  let r = await get('/api/history?symbol=BTCUSDT'); assert.deepEqual(await r.json(), []);
  await get('/api/data?symbol=BTCUSDT&depth=5');
  r = await get('/api/history?symbol=BTCUSDT'); const rows = await r.json();
  assert.equal(r.headers.get('x-history-source'), 'memory');
  assert.equal(rows.length, 1); assert.equal(rows[0].bidUSD, EXPECTED_5PCT.bidUSD); assert.equal(rows[0].askUSD, EXPECTED_5PCT.askUSD);
});
test('GET /api/history: bucket выравнивает время по границе корзины, since отсекает старое', async () => {
  await get('/api/data?symbol=BTCUSDT');
  const rows = await (await get('/api/history?symbol=BTCUSDT&bucket=60')).json();
  assert.equal(rows.length, 1); assert.equal(new Date(rows[0].timestamp).getTime() % 60000, 0);
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.deepEqual(await (await get(`/api/history?symbol=BTCUSDT&since=${future}`)).json(), []);
});
test('GET /api/history: валидация параметров, границы limit', async () => {
  for (const q of ['limit=0', 'limit=20001', 'limit=1.5', 'bucket=-1', 'bucket=86401', 'since=abc', 'symbol=%3Cscript%3E']) {
    assert.equal((await get('/api/history?' + q)).status, 400, q);
  }
  assert.equal((await get('/api/history?limit=20000&bucket=86400')).status, 200);
});
test('GET /api/scan: топ по обороту, limit и валидация', async () => {
  const r = await get('/api/scan?depth=2&limit=2'); const b = await r.json();
  assert.equal(r.status, 200); assert.deepEqual(b.map(x => x.symbol), ['ETHUSDT', 'XRPUSDT']);
  for (const k of ['price', 'change', 'volume', 'bidUSD', 'askUSD', 'imbalance']) assert.equal(typeof b[0][k], 'number', k);
  for (const q of ['limit=0', 'limit=201', 'depth=0']) assert.equal((await get('/api/scan?' + q)).status, 400, q);
});
test('неизвестный маршрут → 404 JSON', async () => {
  const r = await get('/api/nope'); assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Not found', path: '/api/nope' });
});
test('POST с некорректным JSON не роняет сервер и даёт 4xx', async () => {
  const r = await fetch(srv.base + '/api/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.ok(r.status >= 400 && r.status < 500);
  assert.equal((await get('/api/health')).status, 200);
});

// ---- индикаторы (нужен настоящий Express: запускается командой npm test после npm install)
import fs from 'node:fs';
const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/rinar-golden.json', import.meta.url), 'utf8'));
const goldenKlines = golden.times.map((t, i) => [t * 1000, String(golden.open[i]), String(golden.high[i]), String(golden.low[i]), String(golden.close[i]), String(golden.volume[i]), 0, '0']);
const withKlines = async (fn) => {
  mock.restore(); mock = installMexcMock({ '/api/v3/klines': () => goldenKlines });
  try { await fn(); } finally { mock.restore(); mock = installMexcMock(); }
};
test('GET /api/klines: limit и часовой интервал 60m / 1h', async () => {
  await get('/api/klines?symbol=BTCUSDT&interval=1h&limit=300');
  assert.ok(mock.calls.some(c => c.includes('/klines') && c.includes('interval=60m') && c.includes('limit=300')));
  assert.equal((await get('/api/klines?interval=60m')).status, 200);
  for (const q of ['limit=0', 'limit=501', 'limit=abc']) assert.equal((await get('/api/klines?' + q)).status, 400, q);
});
test('GET /api/indicators/catalog', async () => {
  const r = await get('/api/indicators/catalog'); const b = await r.json();
  assert.equal(r.status, 200); assert.ok(b.some(i => i.id === 'rinar') && b.some(i => i.id === 'macd'));
});
test('GET /api/indicators: расчёт по свечам MEXC, limit, заголовки JSON', async () => {
  await withKlines(async () => {
    const r = await get('/api/indicators?symbol=BTCUSDT&interval=1d&names=ema20,rsi14,rinar&limit=40'); const b = await r.json();
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /json/);
    assert.deepEqual(Object.keys(b.indicators), ['ema20', 'rsi14', 'rinar']);
    assert.equal(b.indicators.ema20.lines[0].points.length, 40); assert.equal(b.indicators.rinar.lines.length, 7);
  });
});
test('GET /api/indicators: валидация (names, таймфрейм Rinar, limit, symbol) → 400', async () => {
  for (const q of ['', 'names=', 'names=nope', 'names=rinar&interval=1m', 'names=ema20&limit=0', 'names=ema20&limit=501', 'names=ema20&symbol=%24%24', 'names=ema20&interval=7m']) {
    assert.equal((await get('/api/indicators?' + q)).status, 400, q);
  }
});
test('GET /api/indicators: ошибка MEXC → 502', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    mock.restore(); mock = installMexcMock({ '/api/v3/klines': () => json({ code: -1121, msg: 'Invalid symbol' }, 400) });
    assert.equal((await get('/api/indicators?symbol=NOPEUSDT&names=ema20')).status, 502);
  } finally { console.error = quiet; mock.restore(); mock = installMexcMock(); }
});
