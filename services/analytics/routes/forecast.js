// ВИ 5.1: прогноз показателя на основе истории индикатора.
// GET /forecast?symbol=BTCUSDT&target=imbalance&hours=6&bucket=60&horizon=10
import { Router } from 'express';
import { dbReady } from '../../../shared/mongo.js';
import { forecastLinear, trendDirection } from '../lib/stats.js';
import { loadSeries, pickBucket } from '../lib/series.js';
import { Forecast } from '../models/forecast.js';

export const forecastRouter = Router();
const TARGETS = ['imbalance', 'price', 'bidUSD', 'askUSD'];
const MIN_POINTS = 5;

forecastRouter.get('/forecast', async (req, res) => {
    try {
        const symbol  = String(req.query.symbol || 'BTCUSDT').toUpperCase();
        const target  = TARGETS.includes(req.query.target) ? req.query.target : 'imbalance';
        const hours   = Math.min(Math.max(parseFloat(req.query.hours) || 6, 1), 168);
        const horizon = Math.min(Math.max(parseInt(req.query.horizon) || 10, 1), 100);
        const bucket  = pickBucket(hours, req.query.bucket);

        const rows = await loadSeries(symbol, hours, bucket);
        const ys = rows.map(r => r[target]).filter(Number.isFinite);
        if (ys.length < MIN_POINTS) {
            return res.status(422).json({ error: `Недостаточно данных для прогноза: ${ys.length} точек, нужно минимум ${MIN_POINTS}`, points: ys.length });
        }

        const { model, values } = forecastLinear(ys, horizon);
        const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
        const direction = trendDirection(model, ys.length, mean);
        const lastT = new Date(rows[rows.length - 1].timestamp).getTime();
        const points = values.map((value, k) => ({ t: new Date(lastT + (k + 1) * bucket * 1000), value }));

        const result = {
            symbol, target, method: 'linear', hours, bucketSec: bucket, horizon,
            sourcePoints: ys.length, ...model, direction,
            last: { t: new Date(lastT), value: ys[ys.length - 1] }, points
        };
        if (dbReady()) Forecast.create(result).catch(() => {});
        res.json(result);
    } catch (e) { res.status(502).json({ error: e.message }); }
});
