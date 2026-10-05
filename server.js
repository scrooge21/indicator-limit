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
const HISTORY_TTL_SECONDS = 7 * 24 * 3600;   // хранить историю 7 дней
const LOG_INTERVAL_MS     = 15000;           // период записи точек
const FETCH_TIMEOUT_MS    = 8000;            // таймаут запросов к бирже

// Пары, для которых сервер сам копит историю (через запятую, переменная PINNED_PAIRS).
// История пишется ТОЛЬКО отсюда — число открытых вкладок на размер базы не влияет.
const PINNED_PAIRS = (process.env.PINNED_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const historySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    symbol:    String,
    price:     Number,
    bidUSD:    Number,
    askUSD:    Number,
    imbalance: Number
}, {
    autoIndex:  false,   // индексы синхронизируем явно ниже (syncIndexes)
    versionKey: false    // не храним лишнее поле __v
});
// Единственный индекс по timestamp — TTL (он же обслуживает сортировку по времени)
historySchema.index({ timestamp: 1 }, { expireAfterSeconds: HISTORY_TTL_SECONDS });
// Под запросы /api/history: фильтр по symbol + диапазон и сортировка по timestamp
historySchema.index({ symbol: 1, timestamp: 1 });
const History = mongoose.model('History', historySchema);

if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(async () => {
            console.log('✅ MongoDB Connected');
            try {
                // Приводит индексы в базе к схеме: убирает дубли/старые (в т.ч. обычный
                // timestamp_1, из-за которого TTL не создавался) и создаёт недостающие.
                const dropped = await History.syncIndexes();
                console.log('✅ Indexes synced', dropped.length ? `(dropped: ${dropped.join(', ')})` : '');
            } catch (err) {
                console.error('❌ Index sync error:', err.message);
            }
        })
        .catch(err => console.error('❌ MongoDB Error:', err));
}

// ── Background logger for "pinned" pairs ─────────────────────────────────
async function fetchJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

async function fetchSnapshot(symbol) {
    const [ticker, book] = await Promise.all([
        fetchJson(`${BASE_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`),
        fetchJson(`${BASE_URL}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=1000`)
    ]);
    const price  = parseFloat(ticker.price);
    const bidUSD = book.bids.filter(b => parseFloat(b[0]) >= price * 0.95).reduce((s, b) => s + (parseFloat(b[0]) * parseFloat(b[1])), 0);
    const askUSD = book.asks.filter(a => parseFloat(a[0]) <= price * 1.05).reduce((s, a) => s + (parseFloat(a[0]) * parseFloat(a[1])), 0);
    return { symbol, price, bidUSD, askUSD, imbalance: askUSD > 0 ? bidUSD / askUSD : 0 };
}

// Цикл на setTimeout: следующий круг стартует только после завершения предыдущего,
// поэтому итерации не накладываются, даже если биржа отвечает медленно.
async function backgroundLogger() {
    const started = Date.now();
    try {
        if (mongoose.connection.readyState === 1 && PINNED_PAIRS.length) {
            const results = await Promise.allSettled(PINNED_PAIRS.map(fetchSnapshot));
            const timestamp = new Date();   // одна метка времени на все пары круга
            const docs = [];
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') docs.push({ ...r.value, timestamp });
                else console.error(`backgroundLogger ${PINNED_PAIRS[i]}:`, r.reason?.message || r.reason);
            });
            if (docs.length) await History.insertMany(docs, { ordered: false });
        }
    } catch (e) {
        console.error('backgroundLogger error:', e.message);
    } finally {
        setTimeout(backgroundLogger, Math.max(0, LOG_INTERVAL_MS - (Date.now() - started)));
    }
}
if (process.env.MONGODB_URI) setTimeout(backgroundLogger, LOG_INTERVAL_MS);

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

// ── API: Live data ───────────────────────────────────────────────────────
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

        // В базу отсюда не пишем: историю копит только backgroundLogger.
        res.json({ price, bidUSD, askUSD, book, symbol });
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
    } catch (e) {
        console.error('history error:', e.message);
        res.json([]);
    }
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