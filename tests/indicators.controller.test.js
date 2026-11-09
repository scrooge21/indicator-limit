// Контроллеры индикаторов и свечей вызываются напрямую (без Express): проверяют разбор параметров и коды ошибок.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as controller from '../src/controllers/market.controller.js';
import { installMexcMock } from './helpers/mexc-mock.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/rinar-golden.json'), 'utf8'));
const KLINES = g.times.map((t, i) => [t * 1000, String(g.open[i]), String(g.high[i]), String(g.low[i]), String(g.close[i]), String(g.volume[i]), 0, '0']);

let mock;
beforeEach(() => { mock = installMexcMock({ '/api/v3/klines': () => KLINES }); });
afterEach(() => mock.restore());

const call = async (handler, query = {}) => {
  let body; const res = { json(b) { body = b; return this; }, set() { return this; } };
  await handler({ query }, res); return body;
};
const status = async (handler, query) => { try { await call(handler, query); return 200; } catch (e) { return e.status || 500; } };
const upstream = () => mock.calls.filter(c => c.includes('/klines')).at(-1);

test('klines: limit по умолчанию 200, границы 1–500, 1h → 60m, 60m принимается', async () => {
  await call(controller.klines, { symbol: 'btcusdt', interval: '5m' });
  assert.match(upstream(), /limit=200/); assert.match(upstream(), /interval=5m/); assert.match(upstream(), /symbol=BTCUSDT/);
  await call(controller.klines, { interval: '1h', limit: '500' }); assert.match(upstream(), /interval=60m/); assert.match(upstream(), /limit=500/);
  await call(controller.klines, { interval: '60m' }); assert.match(upstream(), /interval=60m/);
  for (const q of [{ limit: '0' }, { limit: '501' }, { limit: '1.5' }, { interval: '7m' }, { symbol: 'BTC/USDT' }]) assert.equal(await status(controller.klines, q), 400, JSON.stringify(q));
});
test('indicatorCatalog: отдаёт каталог', async () => {
  const body = await call(controller.indicatorCatalog);
  assert.ok(Array.isArray(body) && body.some(i => i.id === 'rinar' && i.intervals[0] === '1d') && body.some(i => i.id === 'rsi14'));
});
test('indicators: расчёт, limit и ответ с описанием линий', async () => {
  const body = await call(controller.indicators, { symbol: 'BTCUSDT', interval: '1d', names: 'ema20,rsi14,macd', limit: '30' });
  assert.equal(body.symbol, 'BTCUSDT'); assert.equal(body.interval, '1d'); assert.equal(body.candles, 450);
  assert.deepEqual(Object.keys(body.indicators), ['ema20', 'rsi14', 'macd']);
  assert.equal(body.indicators.ema20.lines[0].points.length, 30);
  assert.equal(body.indicators.rsi14.placement, 'pane'); assert.ok(body.indicators.macd.histogram.length === 30);
  assert.match(upstream(), /limit=500/);
});
test('indicators: час как 1h уходит в MEXC как 60m', async () => {
  const body = await call(controller.indicators, { interval: '1h', names: 'ema20' });
  assert.equal(body.interval, '60m'); assert.match(upstream(), /interval=60m/);
});
test('indicators: ошибки параметров → 400 и без обращения к бирже', async () => {
  const bad = [{}, { names: '' }, { names: 'nope' }, { names: 'rinar', interval: '1m' }, { names: 'ema20', limit: '0' }, { names: 'ema20', limit: '501' }, { names: 'ema20', symbol: '$$' }, { names: 'ema20', interval: '7m' }, { names: 'ema20;x' }];
  for (const q of bad) assert.equal(await status(controller.indicators, q), 400, JSON.stringify(q));
  assert.equal(mock.calls.length, 0);
});
test('indicators: Rinar на 1d работает и отдаёт метки', async () => {
  const body = await call(controller.indicators, { interval: '1d', names: 'rinar', limit: '450' });
  assert.equal(body.indicators.rinar.lines.length, 7); assert.equal(body.indicators.rinar.markers.length, 1);
});
test('indicators: сбой биржи пробрасывается с кодом 502', async () => {
  mock.restore(); mock = installMexcMock({ '/api/v3/klines': () => { throw new TypeError('network'); } });
  assert.equal(await status(controller.indicators, { names: 'ema20' }), 502);
});
