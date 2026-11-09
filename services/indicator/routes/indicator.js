// Маршруты сервиса «Индикатор и история»: расчёт индикатора, запись и выдача истории.
import { Router } from 'express';
import { URLS } from '../../../shared/config.js';
import { getJson, qs } from '../../../shared/http.js';
import { windowSums } from '../../../shared/imbalance.js';
import { dbReady } from '../../../shared/mongo.js';
import { History } from '../models/history.js';

export const indicatorRouter = Router();

const clampDepth = (v) => Math.min(Math.max(parseFloat(v) || 5, 0.1), 50);

// ВИ 2.1: индикатор для пары (цену и стакан берём у сервиса «Рыночные данные»)
indicatorRouter.get('/data', async (req, res) => {
    try {
        const symbol   = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const depthPct = clampDepth(req.query.depth);

        const { price, book } = await getJson(`${URLS.market}/snapshot?${qs({ symbol, limit: 1000 })}`);
        const sums = windowSums(book, price, depthPct);

        // ВИ 2.4: запись замера асинхронно, ответ клиенту не блокируется
        if (dbReady()) {
            History.create({ symbol, price, ...sums, depthPct, source: 'client' }).catch(() => {});
        }
        res.json({ price, bidUSD: sums.bidUSD, askUSD: sums.askUSD, book, symbol });
    } catch (e) {
        res.status(e.status === 400 ? 400 : 502).json({ error: e.message });
    }
});

// ВИ 2.2 / 2.3: история индикатора. Параметры: symbol, since (Unix, сек), bucket (сек), limit, depth
indicatorRouter.get('/history', async (req, res) => {
    try {
        if (!dbReady()) return res.json([]);
        const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const limit  = Math.min(parseInt(req.query.limit) || 2000, 20000);
        const bucket = parseInt(req.query.bucket) || 0;
        const match  = { symbol };
        if (req.query.since) match.timestamp = { $gte: new Date(parseInt(req.query.since, 10) * 1000) };
        if (req.query.depth) match.depthPct = parseFloat(req.query.depth);

        if (bucket > 0) {
            const bucketMs = bucket * 1000;
            const data = await History.aggregate([
                { $match: match },
                { $sort: { timestamp: 1 } },
                { $group: {
                    _id: { $subtract: [{ $toLong: '$timestamp' }, { $mod: [{ $toLong: '$timestamp' }, bucketMs] }] },
                    timestamp: { $last: '$timestamp' },
                    price:     { $last: '$price' },
                    bidUSD:    { $last: '$bidUSD' },
                    askUSD:    { $last: '$askUSD' },
                    imbalance: { $last: '$imbalance' }
                } },
                { $sort: { _id: 1 } },
                { $limit: limit },
                { $project: { _id: 0, timestamp: 1, price: 1, bidUSD: 1, askUSD: 1, imbalance: 1 } }
            ]);
            return res.json(data);
        }
        res.json(await History.find(match).sort({ timestamp: 1 }).limit(limit).lean());
    } catch { res.json([]); }
});
