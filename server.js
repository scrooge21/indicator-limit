// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import fetch from 'node-fetch';
import mongoose from 'mongoose'; // Подключаем базу данных

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = 'https://api.mexc.com';

let cachedSymbols = []; 

// ─── ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ MONGODB ──────────────────────
const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.warn("⚠️ ВНИМАНИЕ: MONGODB_URI не найден в .env файле!");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Успешно подключено к MongoDB'))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));
}

// Создаем схему (таблицу) для сохранения истории
const historySchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  symbol: String,
  price: Number,
  bidUSD: Number,
  askUSD: Number,
  imbalance: Number
});

const History = mongoose.model('History', historySchema);

// ─── Утилиты ───────────────────────────────────────────────
async function publicGet(path, params = {}) {
  const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
  return res.json();
}

async function loadSymbols() {
  try {
    const data = await publicGet('/api/v3/exchangeInfo');
    cachedSymbols = data.symbols
      .filter(s => s.status === 'ENABLED' && s.quoteAsset === 'USDT')
      .map(s => s.symbol);
    console.log(`✅ Загружено ${cachedSymbols.length} торговых пар.`);
  } catch (e) { console.error('Ошибка загрузки пар:', e.message); }
}
loadSymbols();

// ─── Логика Индикатора ──────────────────────────────────────
function calcDepthImbalance(bids, asks, currentPrice, depthPct) {
  const lowerBound = currentPrice * (1 - depthPct / 100);
  const upperBound = currentPrice * (1 + depthPct / 100);

  const validBids = bids.filter(([p]) => parseFloat(p) >= lowerBound);
  const validAsks = asks.filter(([p]) => parseFloat(p) <= upperBound);

  const bidVolume = validBids.reduce((sum, [, v]) => sum + parseFloat(v), 0);
  const askVolume = validAsks.reduce((sum, [, v]) => sum + parseFloat(v), 0);

  const bidVolUSD = validBids.reduce((sum, [p, v]) => sum + (parseFloat(p) * parseFloat(v)), 0);
  const askVolUSD = validAsks.reduce((sum, [p, v]) => sum + (parseFloat(p) * parseFloat(v)), 0);

  const imbalance = askVolume > 0 ? bidVolume / askVolume : 0;
  return { bidVolume, askVolume, bidVolUSD, askVolUSD, imbalance };
}

// ─── ФОНОВЫЙ СБОРЩИК В БАЗУ ДАННЫХ ──────────────────────────
async function backgroundLogger() {
  if (mongoose.connection.readyState !== 1) return; // Ждем подключения к БД

  try {
    const symbol = 'BTCUSDT';
    const depthPct = 5.0;

    const [book, priceData] = await Promise.all([
      publicGet('/api/v3/depth', { symbol, limit: 1000 }),
      publicGet('/api/v3/ticker/price', { symbol })
    ]);

    const price = parseFloat(priceData.price);
    const depth = calcDepthImbalance(book.bids, book.asks, price, depthPct);

    // Сохраняем в облачную базу данных
    await History.create({
      symbol: symbol,
      price: price,
      bidUSD: depth.bidVolUSD,
      askUSD: depth.askVolUSD,
      imbalance: depth.imbalance
    });

    // Очистка старых данных (оставляем только последние 10,000 записей, чтобы не забить бесплатный лимит)
    const count = await History.countDocuments({ symbol });
    if (count > 10000) {
      const oldest = await History.find({ symbol }).sort({ timestamp: 1 }).limit(count - 10000);
      const idsToDelete = oldest.map(doc => doc._id);
      await History.deleteMany({ _id: { $in: idsToDelete } });
    }

  } catch (err) {
    console.error('Ошибка логгера БД:', err.message);
  }
}
// Сохраняем историю каждые 10 секунд
setInterval(backgroundLogger, 10000);

// ─── Роуты Сервера ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/symbols', (req, res) => res.json(cachedSymbols));

// Отдаем историю из базы данных
app.get('/api/history', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    
    // Берем последние 120 записей из базы
    const records = await History.find({ symbol: 'BTCUSDT' })
                                 .sort({ timestamp: -1 }) // Сначала свежие
                                 .limit(120);
    
    // Переворачиваем, чтобы на графике было слева-направо (от старых к новым)
    records.reverse();

    const history = records.map(r => ({
      time: r.timestamp,
      symbol: r.symbol,
      imbalance: r.imbalance,
      bidUSD: r.bidUSD,
      askUSD: r.askUSD
    }));

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/data', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'BTCUSDT';
    const depthPct = parseFloat(req.query.depth) || 5.0; 

    const [bookData, priceData] = await Promise.all([
      publicGet('/api/v3/depth', { symbol, limit: 1000 }),
      publicGet('/api/v3/ticker/price', { symbol }),
    ]);

    const price = parseFloat(priceData.price);
    const depth = calcDepthImbalance(bookData.bids, bookData.asks, price, depthPct);

    res.json({ price, book: bookData, depth });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/scanner', async (req, res) => {
  try {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : ['BTCUSDT'];
    const depthPct = parseFloat(req.query.depth) || 5.0; 
    
    const promises = symbols.slice(0, 20).map(async (symbol) => {
      try {
        const [book, priceData] = await Promise.all([
          publicGet('/api/v3/depth', { symbol, limit: 500 }), 
          publicGet('/api/v3/ticker/price', { symbol })
        ]);
        const price = parseFloat(priceData.price);
        const depth = calcDepthImbalance(book.bids, book.asks, price, depthPct);
        return { symbol, price, ...depth };
      } catch (e) { return null; }
    });

    const results = (await Promise.all(promises)).filter(r => r !== null);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});