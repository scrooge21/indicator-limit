// Заготовка любого сервиса: Express, /health, обработка ошибок, запуск.
import express from 'express';
import { fileURLToPath } from 'url';
import { HOST } from './config.js';

export function createService(name) {
    const app = express();
    app.disable('x-powered-by');
    app.get('/health', (req, res) => res.json({ service: name, status: 'ok' }));
    return app;
}

export function finishService(app, name) {
    app.use((req, res) => res.status(404).json({ error: 'Not found' }));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        console.error(`[${name}]`, err.message);
        res.status(err.status || 500).json({ error: err.message });
    });
    return app;
}

// true, если файл запущен напрямую (node main.js), а не импортирован в тесте
export const isEntry = (metaUrl) => process.argv[1] === fileURLToPath(metaUrl);

export function listen(app, port, name, host = HOST) {
    return new Promise((resolve) => {
        const server = app.listen(port, host, () => {
            console.log(`🚀 [${name}] http://${host}:${port}`);
            resolve(server);
        });
    });
}
