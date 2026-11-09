import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mexcService, calculateLiquidity } from '../src/services/mexc.service.js';
import { installMexcMock, json, BOOK, EXPECTED_5PCT } from './helpers/mexc-mock.js';

let mock;
afterEach(() => mock?.restore());

test('calculateLiquidity: суммирует котируемую стоимость внутри диапазона', () => {
  const r = calculateLiquidity(BOOK, 100, 5);
  assert.equal(r.bidUSD, EXPECTED_5PCT.bidUSD); assert.equal(r.askUSD, EXPECTED_5PCT.askUSD);
  assert.ok(Math.abs(r.imbalance - 299 / 309) < 1e-12);
});
test('calculateLiquidity: расширение глубины увеличивает объём', () => {
  assert.ok(calculateLiquidity(BOOK, 100, 20).bidUSD > calculateLiquidity(BOOK, 100, 5).bidUSD);
});
test('calculateLiquidity: пустой/битый стакан не падает', () => {
  for (const book of [null, undefined, {}, { bids: null, asks: 'x' }, { bids: [], asks: [] }]) {
    assert.deepEqual(calculateLiquidity(book, 100, 5), { bidUSD: 0, askUSD: 0, imbalance: 0 });
  }
});
test('calculateLiquidity: нулевой ask → imbalance 0 (без деления на ноль)', () => {
  const r = calculateLiquidity({ bids: [['100', '1']], asks: [] }, 100, 5);
  assert.equal(r.imbalance, 0); assert.equal(r.bidUSD, 100);
});

test('mexcService: передаёт параметры запроса', async () => {
  mock = installMexcMock();
  await mexcService.depth('BTCUSDT', 500);
  assert.ok(mock.calls.includes('/api/v3/depth?symbol=BTCUSDT&limit=500'));
});
test('mexcService: сетевая ошибка → 502', async () => {
  mock = installMexcMock({ '/api/v3/depth': () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(mexcService.depth('BTCUSDT'), e => e.status === 502 && /Unable to reach/.test(e.message));
});
test('mexcService: тайм-аут → 504', async () => {
  mock = installMexcMock({ '/api/v3/depth': () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
  await assert.rejects(mexcService.depth('BTCUSDT'), e => e.status === 504);
});
test('mexcService: HTTP-ошибка биржи → 502 с её сообщением', async () => {
  mock = installMexcMock({ '/api/v3/depth': () => json({ msg: 'Invalid symbol' }, 400) });
  await assert.rejects(mexcService.depth('X'), e => e.status === 502 && e.message === 'Invalid symbol');
});
test('mexcService: код ошибки в теле 200-ответа → исключение', async () => {
  mock = installMexcMock({ '/api/v3/depth': () => json({ code: 700002, msg: 'Signature invalid' }) });
  await assert.rejects(mexcService.depth('X'), /Signature invalid/);
});
