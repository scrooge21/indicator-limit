// Интеграционный тест: эмулятор биржи → market-data → indicator / scanner → gateway (без MongoDB).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, mexcMock } from './helpers.js';

const P = { mexc: 41000, market: 41001, indicator: 41002, scanner: 41003, analytics: 41004, gateway: 41005 };
process.env.MEXC_BASE_URL = `http://127.0.0.1:${P.mexc}`;
process.env.MARKET_URL    = `http://127.0.0.1:${P.market}`;
process.env.INDICATOR_URL = `http://127.0.0.1:${P.indicator}`;
process.env.SCANNER_URL   = `http://127.0.0.1:${P.scanner}`;
process.env.ANALYTICS_URL = `http://127.0.0.1:${P.analytics}`;   // не запущен — проверим деградацию
process.env.MONGODB_URI   = '';

const servers = [];
const get = async (path) => {
    const r = await fetch(`http://127.0.0.1:${P.gateway}${path}`);
    return { status: r.status, body: await r.json() };
};

before(async () => {
    const { listen } = await import('../shared/service.js');
    const { createApp: market }    = await import('../services/market-data/main.js');
    const { createApp: indicator } = await import('../services/indicator/main.js');
    const { createApp: scanner }   = await import('../services/scanner/main.js');
    const { createApp: gateway }   = await import('../services/gateway/main.js');
    servers.push(await startServer(mexcMock, P.mexc));
    servers.push(await listen(market(),    P.market,    'market-data'));
    servers.push(await listen(indicator(), P.indicator, 'indicator'));
    servers.push(await listen(scanner(),   P.scanner,   'scanner'));
    servers.push(await listen(gateway(),   P.gateway,   'gateway', '127.0.0.1'));
});
after(() => servers.forEach(s => s.close()));

test('/api/symbols: только пары к USDT', async () => {
    const r = await get('/api/symbols');
    assert.deepEqual(r.body, ['BTCUSDT', 'ETHUSDT']);
});

test('/api/klines: свечи проходят через шлюз', async () => {
    const r = await get('/api/klines?symbol=BTCUSDT&interval=1m');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 1);
});

test('/api/klines: некорректный таймфрейм отклоняется', async () => {
    const r = await get('/api/klines?symbol=BTCUSDT&interval=1m%26x');
    assert.equal(r.status, 400);
});

test('/api/data: индикатор рассчитан по данным биржи', async () => {
    const r = await get('/api/data?symbol=BTCUSDT&depth=5');
    assert.equal(r.status, 200);
    assert.equal(r.body.price, 100);
    assert.equal(r.body.bidUSD, 990);
    assert.equal(r.body.askUSD, 505);
    assert.equal(r.body.symbol, 'BTCUSDT');
    assert.ok(Array.isArray(r.body.book.bids));
});

test('/api/history без MongoDB возвращает пустой список', async () => {
    const r = await get('/api/history?symbol=BTCUSDT&bucket=60');
    assert.deepEqual(r.body, []);
});

test('/api/scan: пары отсортированы по обороту, ETHBTC исключена', async () => {
    const r = await get('/api/scan?depth=2&limit=10');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.map(x => x.symbol), ['ETHUSDT', 'BTCUSDT']);
    assert.equal(r.body[0].bidUSD, 990);
    assert.equal(r.body[0].volume, 9000);
    assert.equal(r.body[0].change, -0.5);
});

test('/api/forecast: при недоступном сервисе шлюз отвечает 502', async () => {
    const r = await get('/api/forecast?symbol=BTCUSDT');
    assert.equal(r.status, 502);
    assert.match(r.body.error, /analytics/);
});

test('/api/health: сводка состояния сервисов', async () => {
    const r = await get('/api/health');
    assert.equal(r.body.services.market, 'ok');
    assert.equal(r.body.services.indicator, 'ok');
    assert.equal(r.body.services.scanner, 'ok');
    assert.equal(r.body.services.analytics, 'down');
});

test('шлюз раздаёт клиентскую страницу', async () => {
    const r = await fetch(`http://127.0.0.1:${P.gateway}/index.html`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<html/i);
});
