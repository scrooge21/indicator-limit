// Сервис «Индикатор и история» (контекст 2). Порт по умолчанию 3002. Хранилище: MongoDB (histories).
import { createService, finishService, isEntry, listen } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';
import { connectDatabase } from './database/connection.js';
import { indicatorRouter } from './routes/indicator.js';
import { startLogger } from './logger.js';

export function createApp() {
    const app = createService('indicator');
    app.use('/', indicatorRouter);
    return finishService(app, 'indicator');
}

if (isEntry(import.meta.url)) {
    await connectDatabase();
    startLogger();
    await listen(createApp(), PORTS.indicator, 'indicator');
}
