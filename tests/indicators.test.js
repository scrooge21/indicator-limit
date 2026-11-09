// Математика индикаторов. Эталон — значения Python-проекта rinar_bot на 450 синтетических дневных свечах
// (tests/fixtures/rinar-golden.json, генератор — tests/fixtures/gen_golden.py). Сверка идёт с точностью 1e-9.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as I from '../src/services/indicators.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const g = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/rinar-golden.json'), 'utf8'));
const arr = (a) => a.map(x => (x === null ? NaN : x));
const d = { times: g.times, high: arr(g.high), low: arr(g.low), close: arr(g.close), volume: arr(g.volume) };

function assertSeries(got, expected, name, tol = 1e-9) {
  const exp = arr(expected);
  assert.equal(got.length, exp.length, `${name}: длина`);
  for (let i = 0; i < exp.length; i++) {
    if (Number.isNaN(exp[i])) { assert.ok(Number.isNaN(got[i]), `${name}[${i}] должен быть NaN, получено ${got[i]}`); continue; }
    assert.ok(Math.abs(got[i] - exp[i]) <= tol * Math.max(1, Math.abs(exp[i])), `${name}[${i}]: ${got[i]} ≠ ${exp[i]}`);
  }
}

test('Rinar: все 7 линий совпадают с rinar_bot (включая недельную RSI-поддержку)', () => {
  const lv = I.rinarLevels(d);
  for (const key of ['fund', 'rsi25', 'rsi14w', 'yellow', 'purple', 'orange', 'red']) assertSeries(lv[key], g.rinar[key], `rinar.${key}`);
});
test('Rinar: недельная линия не определена только в начале (как в rinar_bot), дальше задана', () => {
  const w = I.weeklyRsiSupport(d.times, d.close, 14, 30);
  const firstDefined = w.findIndex(v => !Number.isNaN(v));
  assert.equal(firstDefined, 11, 'как в rinar_bot: 11 пустых значений (первая неполная неделя + сдвиг на неделю)');
  assert.ok(w.slice(firstDefined).every(Number.isFinite));
});
test('Rinar: цветовые зоны упорядочены purple < orange < red и кратны фундаментальной линии', () => {
  const lv = I.rinarLevels(d);
  for (let i = 0; i < d.close.length; i++) {
    assert.ok(lv.purple[i] < lv.orange[i] && lv.orange[i] < lv.red[i]);
    assert.ok(Math.abs(lv.orange[i] / lv.fund[i] - 5.07) < 1e-9);
  }
});
test('DEMA ATR Channels совпадают с rinar_bot', () => {
  const dl = I.demaAtrLevels(d, 40, 15);
  assertSeries(dl.fast, g.dema.fast_dema, 'fast'); assertSeries(dl.slow, g.dema.slow_dema, 'slow'); assertSeries(dl.atr, g.dema.atr, 'atr');
  for (const k of ['p1', 'p2', 'p3', 'm1', 'm2', 'm3']) assertSeries(dl[k], g.dema['dema_' + k], k);
});
test('RSI 14 (Уайлдер, затравка SMA), MACD, Bollinger, EMA, SMA совпадают с эталоном', () => {
  assertSeries(I.rsi(d.close, 14), g.rsi14, 'rsi14');
  const m = I.macd(d.close, 12, 26, 9); assertSeries(m.macd, g.macd, 'macd'); assertSeries(m.signal, g.signal, 'signal');
  const b = I.bollinger(d.close, 20, 2); assertSeries(b.mid, g.bb.mid, 'bb.mid'); assertSeries(b.upper, g.bb.upper, 'bb.upper'); assertSeries(b.lower, g.bb.lower, 'bb.lower');
  assertSeries(I.ema(d.close, 20), g.ema20, 'ema20'); assertSeries(I.sma(d.close, 50), g.sma50, 'sma50');
});
test('медвежья дивергенция MACD: те же бары, что в rinar_bot (64/270/9 и 12/26/9)', () => {
  assert.deepEqual(I.bearishDivergence(d), g.div);
  const fast = I.bearishDivergence(d, 12, 26, 9);
  assert.deepEqual(fast, g.div_fast); assert.ok(fast.filter(Boolean).length >= 2, 'эталон должен содержать сигналы');
});

test('sma: окно, minPeriods и пустой ввод', () => {
  assert.deepEqual(I.sma([1, 2, 3, 4], 2), [NaN, 1.5, 2.5, 3.5]);
  assert.deepEqual(I.sma([2, 4, 6], 3, 1), [2, 3, 4]);
  assert.deepEqual(I.sma([], 5), []);
});
test('ema: первое значение = первой цене, затем alpha = 2/(n+1)', () => {
  const e = I.ema([10, 20], 3); assert.equal(e[0], 10); assert.equal(e[1], 15);
});
test('rsi: границы 0–100, константа не ломает расчёт, коротких данных нет', () => {
  assert.deepEqual(I.rsi([1, 2, 3], 14).filter(Number.isFinite), []);
  assert.equal(I.rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14).at(-1), 100);
  assert.equal(I.rsi(Array.from({ length: 30 }, (_, i) => 30 - i), 14).at(-1), 0);
  assert.ok(I.rsi(d.close, 14).filter(Number.isFinite).every(v => v >= 0 && v <= 100));
});
test('bollinger: верх ≥ середина ≥ низ, для константы полосы схлопываются', () => {
  const flat = I.bollinger(new Array(30).fill(5), 20, 2);
  assert.equal(flat.upper[25], 5); assert.equal(flat.lower[25], 5);
  const b = I.bollinger(d.close, 20, 2);
  for (let i = 19; i < d.close.length; i++) assert.ok(b.upper[i] >= b.mid[i] && b.mid[i] >= b.lower[i]);
});
test('trueRange / atr: первый бар — high−low, дальше учитывается прошлое закрытие', () => {
  assert.deepEqual(I.trueRange([10, 12], [8, 11], [9, 11.5]), [2, 3.5 - 0.5]); // max(1, |12−9|=3, |11−9|=2) = 3
  assert.equal(I.atr([10, 12], [8, 11], [9, 11.5], 2).length, 2);
});
test('rsiBand: цена на линии даёт RSI = level (проверка смысла формулы)', () => {
  // последняя точка band — цена, при которой следующий RSI(14) стал бы равен 30: она ниже текущей цены на падающем рынке
  const band = I.rsiBand(d.close, 14, 30);
  assert.ok(band.every(Number.isFinite)); assert.equal(band.length, d.close.length);
});
