import { getSymbols, getMarketData, scanMarket } from '../services/market.service.js';
import { getHistory, historyStats } from '../services/history.service.js';
import { mexcService } from '../services/mexc.service.js';
import { getIndicators, CATALOG, DEFAULT_OUTPUT, WARMUP_CANDLES } from '../services/indicator.service.js';
import { parseInterval, parseNames, parseNumber, parseSymbol } from '../utils/validation.js';

export async function symbols(req, res) { res.json(await getSymbols()); }
export async function klines(req, res) {
  const symbol = parseSymbol(req.query.symbol);
  const interval = parseInterval(req.query.interval);
  const limit = parseNumber(req.query.limit, { name: 'limit', fallback: 200, min: 1, max: 500, integer: true });
  res.json(await mexcService.klines(symbol, interval, limit));
}
export async function marketData(req, res) {
  const symbol = parseSymbol(req.query.symbol);
  const depth = parseNumber(req.query.depth, { name: 'depth', fallback: 5, min: 0.1, max: 20 });
  res.json(await getMarketData(symbol, depth));
}
export async function history(req, res) {
  const symbol = parseSymbol(req.query.symbol);
  const limit = parseNumber(req.query.limit, { name: 'limit', fallback: 2000, min: 1, max: 20000, integer: true });
  const bucket = parseNumber(req.query.bucket, { name: 'bucket', fallback: 0, min: 0, max: 86400, integer: true });
  let since = null;
  if (req.query.since !== undefined) { const seconds = parseNumber(req.query.since, { name: 'since', fallback: 0, min: 0, max: 4102444800 }); since = new Date(seconds * 1000); }
  const { source, rows } = await getHistory({ symbol, since, bucket, limit });
  res.set('X-History-Source', source).json(rows);
}
export async function scan(req, res) {
  const depth = parseNumber(req.query.depth, { name: 'depth', fallback: 2, min: 0.1, max: 20 });
  const limit = parseNumber(req.query.limit, { name: 'limit', fallback: 100, min: 1, max: 200, integer: true });
  res.json(await scanMarket(depth, limit));
}
export async function health(req, res) {
  const history = await historyStats();
  res.json({ status: 'ok', database: history.persistent ? 'connected' : 'disconnected', history, timestamp: new Date().toISOString() });
}
export async function indicatorCatalog(req, res) { res.json(CATALOG); }
export async function indicators(req, res) {
  const symbol = parseSymbol(req.query.symbol);
  const interval = parseInterval(req.query.interval);
  const names = parseNames(req.query.names);
  const limit = parseNumber(req.query.limit, { name: 'limit', fallback: DEFAULT_OUTPUT, min: 1, max: WARMUP_CANDLES, integer: true });
  res.json(await getIndicators({ symbol, interval, names, limit }));
}
