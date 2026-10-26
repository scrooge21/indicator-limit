// API-шлюз (единая точка входа). Порт по умолчанию 10000 (переменная PORT).
// Раздаёт клиентские страницы из public/ и направляет /api/* нужным сервисам.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { finishService, isEntry, listen } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';
import { proxyRouter } from './routes/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.get('/health', (req, res) => res.json({ service: 'gateway', status: 'ok' }));
    app.use(express.static(path.join(__dirname, '../../public')));
    app.use('/', proxyRouter);
    return finishService(app, 'gateway');
}

if (isEntry(import.meta.url)) listen(createApp(), PORTS.gateway, 'gateway', '0.0.0.0');
