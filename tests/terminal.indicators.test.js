// Скрипт страницы терминала исполняется в Node с заглушками DOM и lightweight-charts (без браузера и сети):
// проверяем меню индикаторов, оверлеи, панели RSI/MACD, ограничение Rinar по таймфрейму и очистку.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createEnvironment } from './helpers/dom-stub.js';
import { CATALOG, parseCandles, resolveIndicators, computeIndicators } from '../src/services/indicator.service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/rinar-golden.json'), 'utf8'));
const klines = g.times.map((t, i) => [t * 1000, String(g.open[i]), String(g.high[i]), String(g.low[i]), String(g.close[i]), String(g.volume[i]), 0, '0']);
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

async function boot(enabled) {
  const calls = [];
  const res = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body });
  const fetchImpl = async (url) => {
    calls.push(url); const u = new URL(url, 'http://x');
    if (u.pathname === '/api/symbols') return res(['BTCUSDT']);
    if (u.pathname === '/api/klines') return res(klines.slice(-200));
    if (u.pathname === '/api/history') return res([]);
    if (u.pathname === '/api/data') return res({ price: 100, bidUSD: 10, askUSD: 20, book: { bids: [['99', '1']], asks: [['101', '1']] } });
    if (u.pathname === '/api/indicators/catalog') return res(CATALOG);
    if (u.pathname === '/api/indicators') {
      try { const names = resolveIndicators(u.searchParams.get('names').split(','), u.searchParams.get('interval')); return res({ indicators: computeIndicators(parseCandles(klines), names, 200) }); }
      catch (e) { return res({ error: e.message }, e.status); }
    }
    return res({}, 404);
  };
  const env = createEnvironment({ fetchImpl, storage: { enabledIndicators: JSON.stringify(enabled) } });
  const html = fs.readFileSync(path.join(root, 'views/pages/terminal.ejs'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  const ctx = vm.createContext(env.sandbox); vm.runInContext(code, ctx);
  env.sandbox.window.onload(); await settle();
  // ev — значение как есть (для ссылок и чисел); data — копия через JSON, чтобы объекты из vm-контекста сравнивались deepEqual
  return { env, calls, ev: (x) => vm.runInContext(x, ctx), data: (x) => JSON.parse(JSON.stringify(vm.runInContext(x, ctx))) };
}
const indicatorUrls = (calls) => calls.filter(c => c.includes('/api/indicators?')).map(c => decodeURIComponent(c));
const checkbox = (env, id) => env.byId.get('indMenu').querySelectorAll('input[data-ind]').find(b => b.dataset.ind === id);
const toggle = async (env, id, on) => { const b = checkbox(env, id); b.checked = on; b.listeners.change.forEach(f => f()); await settle(); };

test('сохранённые индикаторы загружаются; Rinar на 1m не запрашивается и заблокирован в меню', async () => {
  const { env, calls, ev } = await boot(['ema20', 'rsi14', 'rinar']);
  const urls = indicatorUrls(calls);
  assert.equal(urls.length, 1); assert.match(urls[0], /names=ema20,rsi14&/); assert.doesNotMatch(urls[0], /rinar/);
  assert.deepEqual(Object.keys(ev('overlaySeries')), ['ema20']); assert.deepEqual(Object.keys(ev('panes')), ['rsi14']);
  assert.equal(env.byId.get('indCount').textContent, '(2)');
  assert.ok(checkbox(env, 'rinar').disabled); assert.ok(!checkbox(env, 'ema20').disabled);
});
test('переключение на 1D включает Rinar: 7 линий и метки дивергенции на свечах', async () => {
  const { env, ev, data } = await boot(['rinar']);
  assert.deepEqual(Object.keys(ev('overlaySeries')), []);
  env.tfButtons.find(b => b.dataset.tf === '1d').click(); await settle();
  assert.equal(ev('overlaySeries.rinar.length'), 7); assert.equal(ev('candleSeries.markers.length'), 1);
  assert.ok(!checkbox(env, 'rinar').disabled);
  env.tfButtons.find(b => b.dataset.tf === '5m').click(); await settle();
  assert.deepEqual(Object.keys(ev('overlaySeries')), []); assert.deepEqual(data('candleSeries.markers'), []);
});
test('MACD открывает панель с гистограммой и двумя линиями; выбор сохраняется в браузере', async () => {
  const { env, data } = await boot([]);
  await toggle(env, 'macd', true);
  assert.deepEqual(data('panes.macd.series.map(s => s.kind)'), ['hist', 'line', 'line']);
  assert.equal(env.byId.get('paneStack').children.length, 1);
  assert.deepEqual(JSON.parse(env.store.enabledIndicators), ['macd']);
});
test('периодическое обновление не пересоздаёт панели, а меняет только серии', async () => {
  const { env, ev } = await boot(['rsi14']);
  const chartBefore = ev('panes.rsi14.chart'), seriesBefore = ev('panes.rsi14.series[0]');
  await ev('refreshIndicators()'); await settle();
  assert.equal(ev('panes.rsi14.chart'), chartBefore); assert.ok(seriesBefore.removed); assert.notEqual(ev('panes.rsi14.series[0]'), seriesBefore);
  assert.equal(env.byId.get('paneStack').children.length, 1);
});
test('отключение всех индикаторов убирает серии, панели и легенду', async () => {
  const { env, ev } = await boot(['ema20', 'rsi14', 'macd']);
  for (const id of ['ema20', 'rsi14', 'macd']) await toggle(env, id, false);
  assert.deepEqual(Object.keys(ev('overlaySeries')), []); assert.deepEqual(Object.keys(ev('panes')), []);
  assert.equal(env.byId.get('paneStack').children.length, 0); assert.equal(env.byId.get('indLegend').innerHTML, '');
});
test('панели индикаторов синхронизируют диапазон времени с основным графиком', async () => {
  const { ev, data } = await boot(['rsi14']);
  ev('chart.timeScale().setVisibleLogicalRange({ from: 10, to: 50 })');
  assert.deepEqual(data('panes.rsi14.chart.range'), { from: 10, to: 50 });
  ev('panes.rsi14.chart.timeScale().setVisibleLogicalRange({ from: 20, to: 60 })');
  assert.deepEqual(data('chart.range'), { from: 20, to: 60 }); assert.deepEqual(data('indicatorChart.range'), { from: 20, to: 60 });
});
