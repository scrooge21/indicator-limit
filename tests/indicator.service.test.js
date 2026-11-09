import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, parseCandles, resolveIndicators, computeIndicators, getIndicators, MAX_INDICATORS_PER_REQUEST } from '../src/services/indicator.service.js';
import { parseInterval, parseNames } from '../src/utils/validation.js';
import { installMexcMock } from './helpers/mexc-mock.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/rinar-golden.json'), 'utf8'));
// Свечи в формате MEXC: [openTime(ms), open, high, low, close, volume, closeTime, quoteVolume]
const KLINES = g.times.map((t, i) => [t * 1000, String(g.open[i]), String(g.high[i]), String(g.low[i]), String(g.close[i]), String(g.volume[i]), t * 1000 + 86399999, '0']);

let mock;
beforeEach(() => { mock = installMexcMock({ '/api/v3/klines': () => KLINES }); });
afterEach(() => mock.restore());

test('parseInterval: 60m и 1h принимаются, 1h уходит на биржу как 60m, мусор → 400', () => {
  assert.equal(parseInterval('60m'), '60m'); assert.equal(parseInterval('1h'), '60m'); assert.equal(parseInterval('5m'), '5m');
  assert.equal(parseInterval(undefined), '1m'); assert.equal(parseInterval(''), '1m');
  assert.throws(() => parseInterval('7m'), e => e.status === 400);
});
test('parseNames: список через запятую, пустое и мусорное → 400', () => {
  assert.deepEqual(parseNames('ema20, rsi14,'), ['ema20', 'rsi14']);
  for (const bad of [undefined, '', ' , ', 'ema20;drop', 'A B']) assert.throws(() => parseNames(bad), e => e.status === 400, String(bad));
});
test('каталог: уникальные id, у каждого есть подпись и размещение; Rinar — только 1d', () => {
  assert.equal(new Set(CATALOG.map(c => c.id)).size, CATALOG.length);
  for (const c of CATALOG) { assert.ok(c.label && c.group && ['overlay', 'pane'].includes(c.placement), c.id); }
  assert.deepEqual(CATALOG.find(c => c.id === 'rinar').intervals, ['1d']);
});
test('resolveIndicators: дубли убираются, неизвестный/несовместимый/лишний → 400', () => {
  assert.deepEqual(resolveIndicators(['ema20', 'ema20', 'rsi14'], '5m'), ['ema20', 'rsi14']);
  assert.throws(() => resolveIndicators(['nope'], '1d'), e => e.status === 400 && /Unknown/.test(e.message));
  assert.throws(() => resolveIndicators(['rinar'], '1m'), e => e.status === 400 && /1d/.test(e.message));
  assert.doesNotThrow(() => resolveIndicators(['rinar'], '1d'));
  assert.throws(() => resolveIndicators([], '1d'), e => e.status === 400);
  const many = CATALOG.map(c => c.id).concat(['a1', 'a2', 'a3']);
  assert.ok(many.length > MAX_INDICATORS_PER_REQUEST); assert.throws(() => resolveIndicators(many, '1d'), e => e.status === 400);
});
test('parseCandles: пропускает битые строки и не-массивы', () => {
  const c = parseCandles([[1000, '1', '2', '0.5', '1.5', '10'], [2000, 'x', '2', '1', '1', '1'], [3000, '1', '2', '0.5', '1.5', '10']]);
  assert.deepEqual(c.times, [1, 3]); assert.deepEqual(c.close, [1.5, 1.5]);
  assert.deepEqual(parseCandles(null).times, []);
});
test('computeIndicators: оставляет последние limit баров, точки без NaN, времена по возрастанию', () => {
  const out = computeIndicators(parseCandles(KLINES), ['ema20', 'sma200', 'macd'], 100);
  for (const id of ['ema20', 'sma200', 'macd']) for (const l of out[id].lines) {
    assert.ok(l.points.length <= 100 && l.points.length > 0, `${id}.${l.key}`);
    assert.ok(l.points.every(p => Number.isFinite(p.value)));
    assert.ok(l.points.every((p, i) => i === 0 || p.time > l.points[i - 1].time));
  }
  assert.equal(out.ema20.lines[0].points.length, 100);
  assert.equal(out.macd.histogram.length, 100); assert.equal(out.macd.placement, 'pane');
  assert.ok(out.macd.histogram.every(p => /^rgba/.test(p.color)));
});
test('computeIndicators: sma200 при 450 свечах определён с 200-й, RSI несёт уровни 30/70 и диапазон 0–100', () => {
  const all = computeIndicators(parseCandles(KLINES), ['sma200', 'rsi14'], 450);
  assert.equal(all.sma200.lines[0].points.length, 450 - 199);
  assert.deepEqual(all.rsi14.levels, [30, 70]); assert.deepEqual(all.rsi14.range, [0, 100]);
});
test('computeIndicators: Rinar — 7 линий и метки дивергенции внутри окна', () => {
  const out = computeIndicators(parseCandles(KLINES), ['rinar'], 450).rinar;
  assert.equal(out.lines.length, 7);
  assert.deepEqual(out.lines.map(l => l.key), ['red', 'orange', 'purple', 'yellow', 'fund', 'rsi25', 'rsi14w']);
  assert.ok(out.markers.every(m => m.shape === 'arrowDown' && m.position === 'aboveBar'));
  assert.equal(out.markers.length, 1); // 64/270/9 на эталоне даёт ровно один сигнал
  const narrow = computeIndicators(parseCandles(KLINES), ['rinar'], 5).rinar;
  assert.ok(narrow.markers.every(m => m.time >= g.times.at(-5)));
});
test('getIndicators: запрашивает у MEXC 500 свечей нужного интервала и считает по ним', async () => {
  const r = await getIndicators({ symbol: 'BTCUSDT', interval: '1d', names: ['ema20', 'rinar'], limit: 50 });
  assert.equal(r.symbol, 'BTCUSDT'); assert.equal(r.interval, '1d'); assert.equal(r.candles, 450);
  assert.ok(mock.calls.some(c => c.includes('/klines') && c.includes('limit=500') && c.includes('interval=1d')));
  assert.equal(r.indicators.ema20.lines[0].points.length, 50);
  assert.deepEqual(Object.keys(r.indicators), ['ema20', 'rinar']);
});
test('getIndicators: валидация раньше запроса к бирже (нет лишних обращений)', async () => {
  await assert.rejects(getIndicators({ symbol: 'BTCUSDT', interval: '1m', names: ['rinar'] }), e => e.status === 400);
  assert.equal(mock.calls.length, 0);
});
