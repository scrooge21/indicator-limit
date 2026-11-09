import test from 'node:test';
import assert from 'node:assert/strict';
import { windowSums } from '../shared/imbalance.js';
import { mapLimit } from '../shared/async.js';
import { describe, linearRegression, forecastLinear, trendDirection } from '../services/analytics/lib/stats.js';
import { normalizeSymbol, normalizeInterval } from '../services/market-data/models/symbol.js';
import { SymbolCache } from '../services/market-data/models/symbolCache.js';
import { buildSummary } from '../services/analytics/routes/report.js';
import { History } from '../services/indicator/models/history.js';

test('windowSums: суммы заявок в окне ±5% и дисбаланс', () => {
    const book = { bids: [['99', '10'], ['90', '5']], asks: [['101', '5'], ['120', '7']] };
    const r = windowSums(book, 100, 5);
    assert.equal(r.bidUSD, 990);          // заявка по 90 вне окна
    assert.equal(r.askUSD, 505);          // заявка по 120 вне окна
    assert.ok(Math.abs(r.imbalance - 990 / 505) < 1e-12);
});

test('windowSums: пустая сторона продажи даёт дисбаланс 0', () => {
    assert.equal(windowSums({ bids: [['99', '1']], asks: [] }, 100, 5).imbalance, 0);
});

test('linearRegression: точная прямая', () => {
    const m = linearRegression([1, 3, 5, 7, 9]);
    assert.ok(Math.abs(m.slope - 2) < 1e-12);
    assert.ok(Math.abs(m.intercept - 1) < 1e-12);
    assert.ok(Math.abs(m.r2 - 1) < 1e-12);
});

test('forecastLinear: продолжение прямой', () => {
    const { values } = forecastLinear([1, 3, 5, 7, 9], 3);
    assert.deepEqual(values.map(v => Math.round(v)), [11, 13, 15]);
});

test('trendDirection: рост, падение, ровно', () => {
    const up = linearRegression([1, 1.1, 1.2, 1.3, 1.4]);
    assert.equal(trendDirection(up, 5, 1.2), 'up');
    const down = linearRegression([1.4, 1.3, 1.2, 1.1, 1]);
    assert.equal(trendDirection(down, 5, 1.2), 'down');
    const flat = linearRegression([1, 1, 1, 1, 1]);
    assert.equal(trendDirection(flat, 5, 1), 'flat');
});

test('describe: среднее, минимум, максимум, последнее', () => {
    const d = describe([1, 2, 3, 4]);
    assert.equal(d.mean, 2.5); assert.equal(d.min, 1); assert.equal(d.max, 4); assert.equal(d.last, 4);
});

test('normalizeSymbol / normalizeInterval отклоняют мусор', () => {
    assert.equal(normalizeSymbol('btcusdt'), 'BTCUSDT');
    assert.throws(() => normalizeSymbol('BTC/../x'), /Некорректное/);
    assert.equal(normalizeInterval('60m'), '60m');
    assert.throws(() => normalizeInterval('1m&limit=1'), /Некорректный/);
});

test('SymbolCache: хранит список до истечения срока', () => {
    const c = new SymbolCache(50);
    assert.equal(c.get(), null);
    c.set(['BTCUSDT']);
    assert.deepEqual(c.get(), ['BTCUSDT']);
});

test('mapLimit: порядок результатов сохраняется, параллелизм ограничен', async () => {
    let active = 0, maxActive = 0;
    const res = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, 5));
        active--; return x * 2;
    });
    assert.deepEqual(res, [2, 4, 6, 8, 10, 12]);
    assert.ok(maxActive <= 2);
});

test('buildSummary: текст отчёта', () => {
    const s = buildSummary('BTCUSDT', 24, { mean: 1.5 }, 'up');
    assert.match(s, /преобладают заявки на покупку/);
    assert.match(s, /растёт/);
});

test('модель History: значения по умолчанию, проверка полей и индексы', async () => {
    const ok = new History({ symbol: 'btcusdt', price: 1, bidUSD: 2, askUSD: 1, imbalance: 2 });
    assert.equal(ok.symbol, 'BTCUSDT');
    assert.equal(ok.depthPct, 5);
    assert.equal(ok.source, 'client');
    await ok.validate();
    const bad = new History({ symbol: 'BTCUSDT', price: 1, bidUSD: -1, askUSD: 1, imbalance: 1, source: 'x' });
    await assert.rejects(() => bad.validate());
    const idx = History.schema.indexes().map(([k, o]) => JSON.stringify(k) + (o.expireAfterSeconds ? ':ttl' : ''));
    assert.deepEqual(idx, ['{"timestamp":1}:ttl', '{"symbol":1,"timestamp":1}']);
});
