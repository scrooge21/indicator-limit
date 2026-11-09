import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { getSymbols, getMarketData, scanMarket, logTrackedPairs, resetSymbolsCache, isTradable } from '../src/services/market.service.js';
import { getHistory, resetHistoryState, getTrackedSymbols } from '../src/services/history.service.js';
import { installMexcMock, json, BOOK, EXPECTED_5PCT } from './helpers/mexc-mock.js';

let mock;
beforeEach(() => { resetHistoryState(); resetSymbolsCache(); env.historyMinIntervalMs = 5000; mock = installMexcMock(); });
afterEach(() => mock.restore());
const hist = (symbol) => getHistory({ symbol, bucket: 0, limit: 100 }).then(r => r.rows);

test('isTradable: поддерживает оба формата статуса MEXC', () => {
  assert.ok(isTradable({ status: '1' })); assert.ok(isTradable({ status: 'ENABLED' })); assert.ok(isTradable({ status: 1 }));
  assert.ok(!isTradable({ status: '2' })); assert.ok(!isTradable({}));
});
test('getSymbols: только торгуемые USDT-пары, результат кэшируется', async () => {
  assert.deepEqual(await getSymbols(), ['BTCUSDT', 'ETHUSDT', 'XRPUSDT']);
  await getSymbols();
  assert.equal(mock.calls.filter(c => c.startsWith('/api/v3/exchangeInfo')).length, 1);
});
test('getMarketData: цена, ликвидность и стакан', async () => {
  const d = await getMarketData('BTCUSDT', 5);
  assert.equal(d.price, 100); assert.equal(d.symbol, 'BTCUSDT'); assert.deepEqual(d.book, BOOK);
  assert.equal(d.bidUSD, EXPECTED_5PCT.bidUSD); assert.equal(d.askUSD, EXPECTED_5PCT.askUSD);
});
test('getMarketData: точка попадает в историю индикатора', async () => {
  await getMarketData('BTCUSDT', 5);
  const rows = await hist('BTCUSDT');
  assert.equal(rows.length, 1); assert.equal(rows[0].bidUSD, EXPECTED_5PCT.bidUSD);
});
test('getMarketData: частые запросы (несколько вкладок) не раздувают историю', async () => {
  for (let i = 0; i < 20; i++) await getMarketData('BTCUSDT', 5);
  assert.equal((await hist('BTCUSDT')).length, 1);
});
test('getMarketData: в историю пишется глубина 5% даже при другом depth запроса', async () => {
  const d = await getMarketData('BTCUSDT', 20);
  assert.ok(d.bidUSD > EXPECTED_5PCT.bidUSD); // ответ — с запрошенной глубиной
  assert.equal((await hist('BTCUSDT'))[0].bidUSD, EXPECTED_5PCT.bidUSD); // история — со стандартной
});
test('getMarketData: открытая пара начинает писаться в фоне', async () => {
  await getMarketData('XRPUSDT', 5);
  assert.ok(getTrackedSymbols().includes('XRPUSDT'));
});
test('getMarketData: некорректная цена → ошибка, история не пишется', async () => {
  await assert.rejects(getMarketData('BADUSDT'), /invalid ticker price/);
  assert.equal((await hist('BADUSDT')).length, 0);
});
test('logTrackedPairs: пишет закреплённые и просмотренные пары, ошибка одной не останавливает остальные', async () => {
  await getMarketData('XRPUSDT', 5);
  mock.restore();
  mock = installMexcMock({ '/api/v3/ticker/price': (u) => { if (u.searchParams.get('symbol') === 'ETHUSDT') throw new TypeError('boom'); return { price: '100' }; } });
  env.historyMinIntervalMs = 0;
  const quiet = console.error; console.error = () => {};
  try { await logTrackedPairs(); } finally { console.error = quiet; }
  assert.equal((await hist('BTCUSDT')).length, 1);
  assert.equal((await hist('SOLUSDT')).length, 1);
  assert.equal((await hist('ETHUSDT')).length, 0);
  assert.ok((await hist('XRPUSDT')).length >= 2);
});
test('scanMarket: только USDT, сортировка по обороту, limit, ликвидность посчитана', async () => {
  const rows = await scanMarket(5, 2);
  assert.deepEqual(rows.map(r => r.symbol), ['ETHUSDT', 'XRPUSDT']);
  assert.equal(rows[0].change, -2); assert.equal(rows[0].volume, 9000); assert.equal(rows[0].bidUSD, EXPECTED_5PCT.bidUSD);
});
test('scanMarket: пара с ошибкой стакана пропускается', async () => {
  mock.restore();
  mock = installMexcMock({ '/api/v3/depth': (u) => u.searchParams.get('symbol') === 'ETHUSDT' ? json({ msg: 'x' }, 500) : BOOK });
  const quiet = console.warn; console.warn = () => {};
  try { assert.deepEqual((await scanMarket(2, 10)).map(r => r.symbol), ['XRPUSDT', 'BTCUSDT']); } finally { console.warn = quiet; }
});
