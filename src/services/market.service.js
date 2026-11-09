import { mexcService, calculateLiquidity } from './mexc.service.js';
import { env } from '../config/env.js';
import { recordSample, watchSymbol, getTrackedSymbols } from './history.service.js';

let symbolsCache = { value: [], expiresAt: 0 };

export const isTradable = (item) => ['1', 'ENABLED', 1].includes(item.status);

export function resetSymbolsCache() { symbolsCache = { value: [], expiresAt: 0 }; }

export async function getSymbols() {
  if (symbolsCache.value.length && Date.now() < symbolsCache.expiresAt) return symbolsCache.value;
  const info = await mexcService.exchangeInfo();
  const symbols = (info.symbols || []).filter(item => item.quoteAsset === 'USDT' && isTradable(item)).map(item => item.symbol);
  symbolsCache = { value: symbols, expiresAt: Date.now() + 5 * 60 * 1000 };
  return symbols;
}

export async function getMarketData(symbol, depthPct = 5) {
  const [ticker, book] = await Promise.all([mexcService.tickerPrice(symbol), mexcService.depth(symbol, 1000)]);
  const price = Number(ticker.price);
  if (!Number.isFinite(price)) throw new Error('MEXC returned an invalid ticker price');
  const liquidity = calculateLiquidity(book, price, depthPct);
  const payload = { price, ...liquidity, book, symbol };
  watchSymbol(symbol);
  // В историю всегда пишем одну и ту же глубину (5%), независимо от параметра depth запроса,
  // и не чаще, чем разрешено троттлингом — иначе БД забивается дублями.
  const stored = depthPct === env.historyDepthPct ? liquidity : calculateLiquidity(book, price, env.historyDepthPct);
  await recordSample({ symbol, price, ...stored }).catch(error => console.error('History record failed:', error.message));
  return payload;
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length); let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; results[index] = await worker(items[index]); }
  });
  await Promise.all(runners); return results;
}

export async function scanMarket(depthPct = 2, limit = 100) {
  const [tickers, info] = await Promise.all([mexcService.ticker24hr(), mexcService.exchangeInfo()]);
  const allowed = new Set((info.symbols || []).filter(s => s.quoteAsset === 'USDT').map(s => s.symbol));
  const top = tickers.filter(t => allowed.has(t.symbol)).sort((a,b) => Number(b.quoteVolume) - Number(a.quoteVolume)).slice(0, limit);
  const results = await mapLimit(top, 8, async ticker => {
    try {
      const book = await mexcService.depth(ticker.symbol, 500);
      const price = Number(ticker.lastPrice);
      const liquidity = calculateLiquidity(book, price, depthPct);
      return { symbol: ticker.symbol, price, change: Number(ticker.priceChangePercent), volume: Number(ticker.quoteVolume), ...liquidity };
    } catch (error) {
      console.warn(`Scanner skipped ${ticker.symbol}:`, error.message); return null;
    }
  });
  return results.filter(Boolean);
}

export async function logTrackedPairs() {
  for (const symbol of getTrackedSymbols()) {
    try {
      const [ticker, book] = await Promise.all([mexcService.tickerPrice(symbol), mexcService.depth(symbol, 1000)]);
      const price = Number(ticker.price);
      if (!Number.isFinite(price)) continue;
      await recordSample({ symbol, price, ...calculateLiquidity(book, price, env.historyDepthPct) });
    } catch (error) { console.error(`Background logger ${symbol}:`, error.message); }
  }
}
