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

// Тело POST /api/history: ручная запись точки истории. symbol и price обязательны; imbalance по умолчанию bidUSD / askUSD.
const bad = (message) => { const error = new Error(message); error.status = 400; return error; };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export function parseHistorySample(body, { now = Date.now(), maxAgeMs = 604800000 } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('JSON body is required');
  if (typeof body.symbol !== 'string' || !body.symbol.trim()) throw bad('symbol is required');
  const symbol = parseSymbol(body.symbol);
  if (!isNum(body.price) || body.price <= 0) throw bad('price must be a number greater than 0');
  const bidUSD = body.bidUSD === undefined ? 0 : body.bidUSD;
  const askUSD = body.askUSD === undefined ? 0 : body.askUSD;
  if (!isNum(bidUSD) || bidUSD < 0) throw bad('bidUSD must be a number >= 0');
  if (!isNum(askUSD) || askUSD < 0) throw bad('askUSD must be a number >= 0');
  let imbalance = askUSD > 0 ? bidUSD / askUSD : 0;
  if (body.imbalance !== undefined) {
    if (!isNum(body.imbalance) || body.imbalance < 0) throw bad('imbalance must be a number >= 0');
    imbalance = body.imbalance;
  }
  let timestamp = new Date(now);
  if (body.timestamp !== undefined) {
    if (typeof body.timestamp !== 'string' || Number.isNaN(Date.parse(body.timestamp))) throw bad('timestamp must be an ISO 8601 date string');
    timestamp = new Date(body.timestamp);
    if (timestamp.getTime() > now + 60000) throw bad('timestamp must not be in the future');
    if (timestamp.getTime() < now - maxAgeMs) throw bad('timestamp is older than the retention period and would be deleted immediately');
  }
  return { timestamp, symbol, price: body.price, bidUSD, askUSD, imbalance };
}
