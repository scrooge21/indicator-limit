// Маршруты сервиса «Рыночные данные»: единственный сервис, который обращается к бирже MEXC.
import { Router } from 'express';
import { MEXC_BASE_URL } from '../../../shared/config.js';
import { getJson, qs } from '../../../shared/http.js';
import { normalizeSymbol, normalizeInterval } from '../models/symbol.js';
import { SymbolCache, FALLBACK_SYMBOLS } from '../models/symbolCache.js';

export const marketRouter = Router();
const cache = new SymbolCache();
const mexc = (path, params = {}) => getJson(`${MEXC_BASE_URL}${path}?${qs(params)}`);

async function loadUsdtSymbols() {
    const cached = cache.get();
    if (cached) return cached;
    const data = await mexc('/api/v3/exchangeInfo');
    const symbols = data.symbols.filter(s => s.quoteAsset === 'USDT').map(s => s.symbol);
    cache.set(symbols);
    return symbols;
}

// ВИ 1.1 / 1.5: список пар к USDT (при ошибке биржи — резервный список)
marketRouter.get('/symbols', async (req, res) => {
    try { res.json(await loadUsdtSymbols()); }
    catch { res.json(FALLBACK_SYMBOLS); }
});

// ВИ 1.2: свечи выбранного таймфрейма
marketRouter.get('/klines', async (req, res, next) => {
    try {
        const symbol   = normalizeSymbol(req.query.symbol);
        const interval = normalizeInterval(req.query.interval);
        const limit    = Math.min(parseInt(req.query.limit) || 200, 1000);
        res.json(await mexc('/api/v3/klines', { symbol, interval, limit }));
    } catch (e) { next(e); }
});

// ВИ 1.3: цена и стакан одним ответом (запросы к бирже выполняются параллельно)
marketRouter.get('/snapshot', async (req, res, next) => {
    try {
        const symbol = normalizeSymbol(req.query.symbol);
        const limit  = Math.min(parseInt(req.query.limit) || 1000, 1000);
        const [ticker, book] = await Promise.all([
            mexc('/api/v3/ticker/price', { symbol }),
            mexc('/api/v3/depth', { symbol, limit }),
        ]);
        res.json({ symbol, price: parseFloat(ticker.price), book });
    } catch (e) { next(e); }
});

// Стакан отдельно (используется сканером)
marketRouter.get('/depth', async (req, res, next) => {
    try {
        const symbol = normalizeSymbol(req.query.symbol);
        const limit  = Math.min(parseInt(req.query.limit) || 500, 1000);
        res.json(await mexc('/api/v3/depth', { symbol, limit }));
    } catch (e) { next(e); }
});

// ВИ 1.4: сводка за 24 часа — топ пар к USDT по обороту
marketRouter.get('/ticker24h', async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 200);
        const [tickers, symbols] = await Promise.all([mexc('/api/v3/ticker/24hr'), loadUsdtSymbols()]);
        const usdt = new Set(symbols);
        const top = tickers
            .filter(t => usdt.has(t.symbol))
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, limit)
            .map(t => ({
                symbol:      t.symbol,
                lastPrice:   parseFloat(t.lastPrice),
                change:      parseFloat(t.priceChangePercent),
                quoteVolume: parseFloat(t.quoteVolume),
            }));
        res.json(top);
    } catch (e) { next(e); }
});
