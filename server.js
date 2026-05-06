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

// Подключение к БД
if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('✅ MongoDB Connected'))
        .catch(err => console.error('❌ MongoDB Error:', err));
}

const historySchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    symbol: String, price: Number, bidUSD: Number, askUSD: Number, imbalance: Number
});
const History = mongoose.model('History', historySchema);

// Фоновый сборщик (BTC, ETH, SOL)
const HISTORY_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
async function backgroundLogger() {
    if (mongoose.connection.readyState !== 1) return;
    try {
        for (const symbol of HISTORY_PAIRS) {
            const ticker = await (await fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`)).json();
            const book = await (await fetch(`${BASE_URL}/api/v3/depth?symbol=${symbol}&limit=1000`)).json();
            const price = parseFloat(ticker.price);
            const bidUSD = book.bids.filter(b => b[0] >= price * 0.95).reduce((s, b) => s + (b[0] * b[1]), 0);
            const askUSD = book.asks.filter(a => a[0] <= price * 1.05).reduce((s, a) => s + (a[0] * a[1]), 0);
            await History.create({ symbol, price, bidUSD, askUSD, imbalance: askUSD > 0 ? bidUSD / askUSD : 0 });
        }
    } catch (e) {}
}
setInterval(backgroundLogger, 20000);

// API
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/symbols', async (req, res) => {
    if (cachedSymbols.length > 0) return res.json(cachedSymbols);
    try {
        const data = await (await fetch(`${BASE_URL}/api/v3/exchangeInfo`)).json();
        cachedSymbols = data.symbols.filter(s => s.quoteAsset === 'USDT').map(s => s.symbol);
        res.json(cachedSymbols);
    } catch (e) { res.json(['BTCUSDT', 'ETHUSDT']); }
});

app.get('/api/klines', async (req, res) => {
    try {
        const r = await fetch(`${BASE_URL}/api/v3/klines?symbol=${req.query.symbol}&interval=1m&limit=100`);
        const data = await r.json();
        res.json(data);
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/data', async (req, res) => {
    try {
        const symbol = req.query.symbol || 'BTCUSDT';
        const depthPct = parseFloat(req.query.depth) || 5.0;
        const [tRes, bRes] = await Promise.all([
            fetch(`${BASE_URL}/api/v3/ticker/price?symbol=${symbol}`),
            fetch(`${BASE_URL}/api/v3/depth?symbol=${symbol}&limit=1000`)
        ]);
        const ticker = await tRes.json();
        const book = await bRes.json();
        const price = parseFloat(ticker.price);
        const bidUSD = book.bids.filter(b => b[0] >= price * (1 - depthPct / 100)).reduce((s, b) => s + (b[0] * b[1]), 0);
        const askUSD = book.asks.filter(a => a[0] <= price * (1 + depthPct / 100)).reduce((s, a) => s + (a[0] * a[1]), 0);
        res.json({ price, bidUSD, askUSD, book, symbol });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history', async (req, res) => {
    try {
        const data = await History.find({ symbol: req.query.symbol }).sort({ timestamp: -1 }).limit(100);
        res.json(data.reverse());
    } catch (e) { res.json([]); }
});

app.listen(PORT, () => console.log(`🚀 Server ready on ${PORT}`));