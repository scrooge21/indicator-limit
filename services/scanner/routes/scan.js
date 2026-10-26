// Маршруты сервиса «Сканер»: ранжирование пар по дисбалансу заявок.
import { Router } from 'express';
import { URLS } from '../../../shared/config.js';
import { getJson, qs } from '../../../shared/http.js';
import { mapLimit } from '../../../shared/async.js';
import { windowSums } from '../../../shared/imbalance.js';
import { dbReady } from '../../../shared/mongo.js';
import { ScanSnapshot } from '../models/scanSnapshot.js';

export const scanRouter = Router();

// ВИ 4.2: GET /scan?depth=2&limit=100[&save=1]
scanRouter.get('/scan', async (req, res) => {
    try {
        const depth = Math.min(Math.max(parseFloat(req.query.depth) || 2, 0.1), 50);
        const limit = Math.min(parseInt(req.query.limit) || 100, 200);

        const top = await getJson(`${URLS.market}/ticker24h?${qs({ limit })}`, { timeoutMs: 15000 });

        // не более 20 одновременных запросов стакана
        const rows = (await mapLimit(top, 20, async (t) => {
            try {
                const book = await getJson(`${URLS.market}/depth?${qs({ symbol: t.symbol, limit: 500 })}`);
                const sums = windowSums(book, t.lastPrice, depth);
                return { symbol: t.symbol, price: t.lastPrice, change: t.change, volume: t.quoteVolume, ...sums };
            } catch { return null; }        // пары с ошибкой исключаются
        })).filter(Boolean);

        if (req.query.save === '1' && dbReady()) {
            ScanSnapshot.create({ depthPct: depth, limit, rows }).catch(() => {});
        }
        res.json(rows);
    } catch (e) { res.status(502).json({ error: e.message }); }
});

// Последние сохранённые снимки (без строк, только метаданные)
scanRouter.get('/scan/snapshots', async (req, res) => {
    if (!dbReady()) return res.json([]);
    const n = Math.min(parseInt(req.query.limit) || 10, 100);
    res.json(await ScanSnapshot.find({}, { rows: 0 }).sort({ createdAt: -1 }).limit(n).lean());
});
