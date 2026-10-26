// Проксирование запросов браузера к внутренним сервисам.
// Клиентский код (public/) не изменился: адреса /api/... остались прежними.
import { Router } from 'express';
import { URLS } from '../../../shared/config.js';
import { getJson } from '../../../shared/http.js';

export const proxyRouter = Router();

// Таблица маршрутизации: префикс на шлюзе → сервис и путь внутри сервиса.
// fallback — ответ, который шлюз отдаёт, если сервис недоступен (поведение монолита сохранено).
export const ROUTES = [
    { prefix: '/api/symbols',        service: 'market',    path: '/symbols',        fallback: { status: 200, body: ['BTCUSDT', 'ETHUSDT'] } },
    { prefix: '/api/klines',         service: 'market',    path: '/klines',         fallback: { status: 500, body: [] } },
    { prefix: '/api/data',           service: 'indicator', path: '/data' },
    { prefix: '/api/history',        service: 'indicator', path: '/history',        fallback: { status: 200, body: [] } },
    { prefix: '/api/scan/snapshots', service: 'scanner',   path: '/scan/snapshots' },
    { prefix: '/api/scan',           service: 'scanner',   path: '/scan' },
    { prefix: '/api/forecast',       service: 'analytics', path: '/forecast' },
    { prefix: '/api/reports',        service: 'analytics', path: '/reports' },
    { prefix: '/api/report',         service: 'analytics', path: '/report' },
];

async function forward(route, req, res) {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const target = `${URLS[route.service]}${route.path}${query}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
        const upstream = await fetch(target, { signal: ctrl.signal });
        res.status(upstream.status);
        res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
        res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
        if (route.fallback) return res.status(route.fallback.status).json(route.fallback.body);
        res.status(502).json({ error: `Сервис «${route.service}» недоступен` });
    } finally { clearTimeout(timer); }
}

for (const route of ROUTES) {
    proxyRouter.get(route.prefix, (req, res) => forward(route, req, res));
}

// Сводная проверка состояния всех сервисов
proxyRouter.get('/api/health', async (req, res) => {
    const names = Object.keys(URLS);
    const results = await Promise.all(names.map(async (n) => {
        try { await getJson(`${URLS[n]}/health`, { timeoutMs: 2000 }); return 'ok'; }
        catch { return 'down'; }
    }));
    const services = Object.fromEntries(names.map((n, i) => [n, results[i]]));
    res.json({ gateway: 'ok', services });
});
