import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import mongoose from 'mongoose';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const BASE_URL = 'https://api.mexc.com';

let cachedSymbols = [];

// ── MongoDB ──────────────────────────────────────────────────────────────
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('✅ MongoDB Connected'))
        .catch(err => console.error('❌ MongoDB Error:', err));
}

const historySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    symbol:    { type: String, index: true },
    price:     Number,
    bidUSD:    Number,
    askUSD:    Number,
    imbalance: Number
});
// TTL: автоматически удалять записи старше 7 дней
historySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
const History = mongoose.model('History', historySchema);

// ── Background logger for "pinned" pairs ─────────────────────────────────
const PINNED_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

async function fetchAndSave(symbol) {
    const ticker = await (await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`)).json();
    const book   = await (await fetch(`${BASE_URL}/api/v3/depth?symbol=${symbol}&limit=1000`)).json();
    const price  = parseFloat(ticker.price);
    const bidUSD = book.bids.filter(b => b[0] >= price * 0.95).reduce((s, b) => s + (parseFloat(b[0]) * parseFloat(b[1])), 0);
    const askUSD = book.asks.filter(a => a[0] <= price * 1.05).reduce((s, a) => s + (parseFloat(a[0]) * parseFloat(a[1])), 0);
    return { symbol, price, bidUSD, askUSD, imbalance: askUSD > 0 ? bidUSD / askUSD : 0 };
}

async function backgroundLogger() {
    if (mongoose.connection.readyState !== 1) return;
    try {
        for (const symbol of PINNED_PAIRS) {
            const d = await fetchAndSave(symbol);
            await History.create(d);
        }
    } catch (e) { console.error('backgroundLogger error:', e.message); }
}
setInterval(backgroundLogger, 15000);

// ── Static files ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Symbols ─────────────────────────────────────────────────────────
app.get('/api/symbols', async (req, res) => {
    if (cachedSymbols.length > 0) return res.json(cachedSymbols);
    try {
        const data = await (await fetch(`${BASE_URL}/api/v3/exchangeInfo`)).json();
        cachedSymbols = data.symbols.filter(s => s.quoteAsset === 'USDT').map(s => s.symbol);
        res.json(cachedSymbols);
    } catch (e) { res.json(['BTCUSDT', 'ETHUSDT']); }
});

// ── API: Klines ──────────────────────────────────────────────────────────
app.get('/api/klines', async (req, res) => {
    try {
        const interval = req.query.interval || '1m';
        const r = await fetch(`${BASE_URL}/api/v3/klines?symbol=${req.query.symbol}&interval=${interval}&limit=200`);
        res.json(await r.json());
    } catch (e) { res.status(500).json([]); }
});

// ── API: Live data — также сохраняем в историю ───────────────────────────
app.get('/api/data', async (req, res) => {
    try {
        const symbol   = (req.query.symbol || 'BTCUSDT').toUpperCase();
        const depthPct = parseFloat(req.query.depth) || 5.0;

        const [tRes, bRes] = await Promise.all([
            fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`),
            fetch(`${BASE_URL}/api/v3/depth?symbol=${symbol}&limit=1000`)
        ]);
        const ticker = await tRes.json();
        const book   = await bRes.json();
        const price  = parseFloat(ticker.price);

        const bidUSD = book.bids
            .filter(b => parseFloat(b[0]) >= price * (1 - depthPct / 100))
            .reduce((s, b) => s + (parseFloat(b[0]) * parseFloat(b[1])), 0);
        const askUSD = book.asks
            .filter(a => parseFloat(a[0]) <= price * (1 + depthPct / 100))
            .reduce((s, a) => s + (parseFloat(a[0]) * parseFloat(a[1])), 0);

        const payload = { price, bidUSD, askUSD, book, symbol };

        // Асинхронно пишем в MongoDB (не блокируем ответ)
        if (mongoose.connection.readyState === 1) {
            History.create({
                symbol, price, bidUSD, askUSD,
                imbalance: askUSD > 0 ? bidUSD / askUSD : 0
            }).catch(() => {});
        }

        res.json(payload);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── API: History ─────────────────────────────────────────────────────────
// Query params:
//   symbol  — торговая пара (default BTCUSDT)
//   since   — Unix-timestamp в секундах; вернуть записи начиная с этого момента
//   bucket  — размер корзины агрегации в секундах (default 0 = без агрегации)
//             при bucket > 0 возвращает по одной точке (последнее значение) на каждый интервал
//   limit   — максимум записей (default 2000, max 20000)
app.get('/api/history', async (req, res) => {
    try {
        const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
        const limit  = Math.min(parseInt(req.query.limit)  || 2000, 20000);
        const bucket = parseInt(req.query.bucket) || 0;   // секунды, 0 = raw
        const since  = req.query.since
            ? new Date(parseInt(req.query.since, 10) * 1000)
            : null;

        const match = { symbol };
        if (since) match.timestamp = { $gte: since };

        if (bucket > 0) {
            // Агрегация: группируем по временным корзинам bucket-секунд,
            // берём последнее bidUSD/askUSD в каждой корзине.
            const bucketMs = bucket * 1000;
            const pipeline = [
                { $match: match },
                { $sort:  { timestamp: 1 } },
                {
                    $group: {
                        _id: {
                            $subtract: [
                                { $toLong: '$timestamp' },
                                { $mod: [{ $toLong: '$timestamp' }, bucketMs] }
                            ]
                        },
                        timestamp: { $last: '$timestamp' },
                        bidUSD:    { $last: '$bidUSD' },
                        askUSD:    { $last: '$askUSD' },
                        imbalance: { $last: '$imbalance' }
                    }
                },
                { $sort:  { _id: 1 } },
                { $limit: limit },
                { $project: { _id: 0, timestamp: 1, bidUSD: 1, askUSD: 1, imbalance: 1 } }
            ];
            const data = await History.aggregate(pipeline);
            return res.json(data);
        }

        // Raw (без агрегации)
        const data = await History
            .find(match)
            .sort({ timestamp: 1 })
            .limit(limit)
            .lean();
        res.json(data);
    } catch (e) { res.json([]); }
});

// ── API: Scan ────────────────────────────────────────────────────────────
app.get('/api/scan', async (req, res) => {
    try {
        const depth = parseFloat(req.query.depth) || 2;
        const limit = Math.min(parseInt(req.query.limit) || 100, 200);

        const [tickerRes, infoRes] = await Promise.all([
            fetch(`${BASE_URL}/api/v3/ticker/24hr`),
            fetch(`${BASE_URL}/api/v3/exchangeInfo`)
        ]);
        const tickers = await tickerRes.json();
        const info    = await infoRes.json();

        const usdtSymbols = new Set(
            info.symbols.filter(s => s.quoteAsset === 'USDT').map(s => s.symbol)
        );

        const top = tickers
            .filter(t => usdtSymbols.has(t.symbol))
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, limit);

        const results = await Promise.all(top.map(async t => {
            try {
                const bRes  = await fetch(`${BASE_URL}/api/v3/depth?symbol=${t.symbol}&limit=500`);
                const book  = await bRes.json();
                const price = parseFloat(t.lastPrice);
                const bidUSD = book.bids
                    .filter(b => parseFloat(b[0]) >= price * (1 - depth / 100))
                    .reduce((s, b) => s + (parseFloat(b[0]) * parseFloat(b[1])), 0);
                const askUSD = book.asks
                    .filter(a => parseFloat(a[0]) <= price * (1 + depth / 100))
                    .reduce((s, a) => s + (parseFloat(a[0]) * parseFloat(a[1])), 0);
                return {
                    symbol:    t.symbol,
                    price,
                    change:    parseFloat(t.priceChangePercent),
                    volume:    parseFloat(t.quoteVolume),
                    bidUSD,
                    askUSD,
                    imbalance: askUSD > 0 ? bidUSD / askUSD : 0
                };
            } catch { return null; }
        }));

        res.json(results.filter(Boolean));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`🚀 Server ready on port ${PORT}`));