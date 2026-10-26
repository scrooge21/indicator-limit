// ВИ 5.2: аналитический отчёт по паре за период; ВИ 5.3: список сохранённых отчётов.
import { Router } from 'express';
import { dbReady } from '../../../shared/mongo.js';
import { describe, forecastLinear, trendDirection } from '../lib/stats.js';
import { loadSeries, pickBucket } from '../lib/series.js';
import { Report } from '../models/report.js';

export const reportRouter = Router();

const DIRECTION_TEXT = { up: 'растёт', down: 'снижается', flat: 'почти не меняется' };

export function buildSummary(symbol, hours, imb, direction) {
    const side = imb.mean > 1.2 ? 'преобладают заявки на покупку'
               : imb.mean < 0.8 ? 'преобладают заявки на продажу'
               : 'заявки на покупку и продажу находятся в равновесии';
    return `${symbol}: за последние ${hours} ч в среднем ${side} (дисбаланс ${imb.mean.toFixed(2)}); ` +
           `по линейной модели дисбаланс ${DIRECTION_TEXT[direction]}.`;
}

reportRouter.get('/report', async (req, res) => {
    try {
        const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const hours  = Math.min(Math.max(parseFloat(req.query.hours) || 24, 1), 168);
        const bucket = pickBucket(hours, req.query.bucket);

        const rows = (await loadSeries(symbol, hours, bucket)).filter(r => Number.isFinite(r.imbalance));
        if (rows.length < 5) {
            return res.status(422).json({ error: `Недостаточно данных для отчёта: ${rows.length} точек, нужно минимум 5`, points: rows.length });
        }

        const imb  = describe(rows.map(r => r.imbalance));
        const bids = describe(rows.map(r => r.bidUSD));
        const asks = describe(rows.map(r => r.askUSD));
        const prices = rows.map(r => r.price).filter(Number.isFinite);
        const priceChangePct = prices.length > 1 ? (prices[prices.length - 1] / prices[0] - 1) * 100 : null;

        const { model } = forecastLinear(rows.map(r => r.imbalance), 1);
        const direction = trendDirection(model, rows.length, imb.mean);

        const report = {
            symbol, hours, bucketSec: bucket,
            from: new Date(rows[0].timestamp), to: new Date(rows[rows.length - 1].timestamp),
            points: rows.length,
            imbalance: { mean: imb.mean, min: imb.min, max: imb.max, last: imb.last, std: imb.std },
            bidUSDMean: bids.mean, askUSDMean: asks.mean, priceChangePct,
            shareBuyers:  rows.filter(r => r.imbalance > 1.2).length / rows.length,
            shareSellers: rows.filter(r => r.imbalance < 0.8).length / rows.length,
            forecast: { direction, slope: model.slope, r2: model.r2 },
            summary: buildSummary(symbol, hours, imb, direction)
        };
        if (dbReady()) Report.create(report).catch(() => {});
        res.json(report);
    } catch (e) { res.status(502).json({ error: e.message }); }
});

reportRouter.get('/reports', async (req, res) => {
    if (!dbReady()) return res.json([]);
    const filter = req.query.symbol ? { symbol: String(req.query.symbol).toUpperCase() } : {};
    const n = Math.min(parseInt(req.query.limit) || 20, 100);
    res.json(await Report.find(filter).sort({ createdAt: -1 }).limit(n).lean());
});
