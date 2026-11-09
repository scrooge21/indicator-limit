export function parseSymbol(value, fallback = 'BTCUSDT') {
  const symbol = String(value || fallback).trim().toUpperCase();
  if (!/^[A-Z0-9]{5,25}$/.test(symbol)) { const error = new Error('Invalid symbol'); error.status = 400; throw error; }
  return symbol;
}
export function parseNumber(value, { name, fallback, min, max, integer = false }) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
    const error = new Error(`${name} must be between ${min} and ${max}${integer ? ' (integer)' : ''}`); error.status = 400; throw error;
  }
  return parsed;
}

// Таймфреймы свечей. MEXC принимает часовой интервал как «60m», поэтому «1h» приводится к нему при запросе к бирже.
export const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '60m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
export function parseInterval(value, fallback = '1m') {
  const interval = String(value || fallback);
  if (!INTERVALS.includes(interval)) { const error = new Error('Unsupported interval'); error.status = 400; throw error; }
  return interval === '1h' ? '60m' : interval;
}
// Список имён индикаторов через запятую: ema20,rsi14
export function parseNames(value) {
  const names = String(value ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (!names.length || names.some(n => !/^[a-z0-9_]{1,30}$/.test(n))) { const error = new Error('names must be a comma-separated list of indicator ids'); error.status = 400; throw error; }
  return names;
}
