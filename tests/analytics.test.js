// Тест сервиса «Аналитика» с заглушкой сервиса истории (имитирует рост дисбаланса).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const P = { indicator: 42002, analytics: 42004 };
process.env.INDICATOR_URL = `http://127.0.0.1:${P.indicator}`;
process.env.MONGODB_URI = '';

const servers = [];
const get = async (path) => {
    const r = await fetch(`http://127.0.0.1:${P.analytics}${path}`);
    return { status: r.status, body: await r.json() };
};

// 20 точек с шагом 60 с: дисбаланс растёт от 1.0 до 1.38
const N = 20, T0 = Date.UTC(2026, 0, 1);
const fakeHistory = (url) => {
    if (url.pathname !== '/history') return null;
    if (url.searchParams.get('symbol') === 'EMPTYUSDT') return [];
    return Array.from({ length: N }, (_, i) => ({
        timestamp: new Date(T0 + i * 60000).toISOString(),
        price: 100 + i, bidUSD: 1000 + 20 * i, askUSD: 1000, imbalance: 1 + 0.02 * i
    }));
};

before(async () => {
    const { listen } = await import('../shared/service.js');
    const { createApp } = await import('../services/analytics/main.js');
    servers.push(await startServer(fakeHistory, P.indicator));
    servers.push(await listen(createApp(), P.analytics, 'analytics', '127.0.0.1'));
});
after(() => servers.forEach(s => s.close()));

test('/forecast: тренд вверх, прогноз продолжает прямую', async () => {
    const r = await get('/forecast?symbol=BTCUSDT&target=imbalance&horizon=3&bucket=60');
    assert.equal(r.status, 200);
    assert.equal(r.body.sourcePoints, N);
    assert.equal(r.body.direction, 'up');
    assert.ok(Math.abs(r.body.slope - 0.02) < 1e-9);
    assert.ok(r.body.r2 > 0.999);
    assert.equal(r.body.points.length, 3);
    assert.ok(Math.abs(r.body.points[0].value - (1 + 0.02 * N)) < 1e-9);
    // шаг по времени равен bucket
    const dt = new Date(r.body.points[1].t) - new Date(r.body.points[0].t);
    assert.equal(dt, 60000);
});

test('/forecast: прогноз цены', async () => {
    const r = await get('/forecast?symbol=BTCUSDT&target=price&horizon=1');
    assert.ok(Math.abs(r.body.points[0].value - 120) < 1e-9);
});

test('/forecast: нет данных — 422', async () => {
    const r = await get('/forecast?symbol=EMPTYUSDT');
    assert.equal(r.status, 422);
});

test('/report: статистика и вывод', async () => {
    const r = await get('/report?symbol=BTCUSDT&hours=24&bucket=60');
    assert.equal(r.status, 200);
    assert.equal(r.body.points, N);
    assert.ok(Math.abs(r.body.imbalance.mean - 1.19) < 1e-9);
    assert.ok(Math.abs(r.body.imbalance.min - 1) < 1e-9);
    assert.ok(Math.abs(r.body.imbalance.max - 1.38) < 1e-9);
    assert.ok(Math.abs(r.body.priceChangePct - 19) < 1e-9);
    assert.equal(r.body.forecast.direction, 'up');
    assert.ok(r.body.shareBuyers > 0 && r.body.shareBuyers < 1);
    assert.match(r.body.summary, /BTCUSDT/);
});

test('/reports без MongoDB — пустой список', async () => {
    const r = await get('/reports');
    assert.deepEqual(r.body, []);
});
