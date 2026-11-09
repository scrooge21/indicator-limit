import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbol, parseNumber } from '../src/utils/validation.js';

test('parseSymbol: нормализует регистр и пробелы', () => assert.equal(parseSymbol('  btcusdt '), 'BTCUSDT'));
test('parseSymbol: подставляет BTCUSDT по умолчанию', () => { assert.equal(parseSymbol(undefined), 'BTCUSDT'); assert.equal(parseSymbol(''), 'BTCUSDT'); });
test('parseSymbol: отклоняет мусор с кодом 400', () => {
  for (const bad of ['BTC/USDT', 'BTC', 'A'.repeat(26), 'BTC USDT', '../etc', 'btc;drop']) {
    assert.throws(() => parseSymbol(bad), e => e.message === 'Invalid symbol' && e.status === 400, bad);
  }
});
const opts = { name: 'depth', fallback: 5, min: 0.1, max: 20 };
test('parseNumber: значение по умолчанию', () => { assert.equal(parseNumber(undefined, opts), 5); assert.equal(parseNumber('', opts), 5); });
test('parseNumber: границы включительно', () => { assert.equal(parseNumber('0.1', opts), 0.1); assert.equal(parseNumber('20', opts), 20); });
test('parseNumber: вне границ / не число → 400', () => {
  for (const bad of ['0.09', '20.1', 'abc', 'NaN', 'Infinity']) assert.throws(() => parseNumber(bad, opts), e => e.status === 400 && /between/.test(e.message), bad);
});
test('parseNumber: integer отклоняет дробные', () => {
  const o = { name: 'limit', fallback: 10, min: 1, max: 100, integer: true };
  assert.equal(parseNumber('7', o), 7);
  assert.throws(() => parseNumber('7.5', o), /integer/);
});
