// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import fetch from 'node-fetch';
import mongoose from 'mongoose';

// Загружаем переменные окружения
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
  console.warn("⚠️ ВНИМАНИЕ: MONGODB_URI не найден в переменных окружения!");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Успешно подключено к MongoDB'))
    .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));
}

// Схема для сохранения истории в базу данных
const historySchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  symbol: String,
  price: Number,
  bidUSD: Number,
  askUSD: Number,
  imbalance: Number
});

const History = mongoose.model('History', historySchema);

// Список пар, для которых сервер собирает историю 24/7 (можете менять)
const HISTORY_PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'PEPEUSDT'];

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
    // Берем только активные спотовые пары к USDT
    cachedSymbols = data.symbols
      .filter(s => s.status === 'ENABLED' && s.quoteAsset === 'USDT')
      .map(s => s.symbol);
    console.log(`✅ Загружено ${cachedSymbols.length} торговых пар с MEXC.`);
  } catch (e) { 
    console.error('Ошибка загрузки пар:', e.message); 
  }
}
// Запускаем при старте сервера
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
  // Если БД еще не подключилась — пропускаем цикл
  if (mongoose.connection.readyState !== 1) return; 

  try {
    const depthPct = 5.0; // Собираем историю всегда на глубине 5%

    for (const symbol of HISTORY_PAIRS) {
      const [book, priceData] = await Promise.all([
        publicGet('/api/v3/depth', { symbol, limit: 1000 }),
        publicGet('/api/v3/ticker/price', { symbol })
      ]);

      const price = parseFloat(priceData.price);
      const depth = calcDepthImbalance(book.bids, book.asks, price, depthPct);

      // Сохраняем в MongoDB
      await History.create({
        symbol: symbol,
        price: price,
        bidUSD: depth.bidVolUSD,
        askUSD: depth.askVolUSD,
        imbalance: depth.imbalance
      });

      // Очистка БД: оставляем только последние 5000 записей для КАЖДОЙ пары
      // (чтобы не превысить бесплатный лимит в 512 МБ на MongoDB Atlas)
      const count = await History.countDocuments({ symbol });
      if (count > 5000) {
        const oldest = await History.find({ symbol }).sort({ timestamp: 1 }).limit(count - 5000);
        const idsToDelete = oldest.map(doc => doc._id);
        await History.deleteMany({ _id: { $in: idsToDelete } });
      }
    }
  } catch (err) {
    console.error('Ошибка логгера БД:', err.message);
  }
}

// Запускаем сборщик каждые 15 секунд
setInterval(backgroundLogger, 15000);


// ─── Роуты Сервера (API) ────────────────────────────────────

// Раздаем статические файлы (наш index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Отдает список всех пар для модального окна поиска
app.get('/api/symbols', (req, res) => res.json(cachedSymbols));

// Отдает историю для графика из БД
app.get('/api/history', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    
    const symbol = req.query.symbol || 'BTCUSDT';

    // Берем последние 200 записей для запрошенной пары
    const records = await History.find({ symbol: symbol })
                                 .sort({ timestamp: -1 }) 
                                 .limit(200);
    
    // Переворачиваем, чтобы на графике было слева направо (от старых к новым)
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

// Отдает текущие данные стакана для основного индикатора
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

// Отдает данные для сканера (массовый запрос нескольких пар)
app.get('/api/scanner', async (req, res) => {
  try {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : ['BTCUSDT'];
    const depthPct = parseFloat(req.query.depth) || 5.0; 
    
    // Параллельно опрашиваем MEXC для каждой пары из сканера
    const promises = symbols.slice(0, 20).map(async (symbol) => {
      try {
        const [book, priceData] = await Promise.all([
          publicGet('/api/v3/depth', { symbol, limit: 500 }), 
          publicGet('/api/v3/ticker/price', { symbol })
        ]);
        const price = parseFloat(priceData.price);
        const depth = calcDepthImbalance(book.bids, book.asks, price, depthPct);
        return { symbol, price, ...depth };
      } catch (e) { return null; } // Пропускаем пару, если биржа выдала ошибку
    });

    const results = (await Promise.all(promises)).filter(r => r !== null);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Запуск сервера ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен: http://localhost:${PORT}`);
});