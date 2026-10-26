// Сервис «Аналитика» (контекст 5): прогнозирование и аналитические отчёты.
// Порт по умолчанию 3004. Хранилище: forecasts, reports (база mexc_analytics).
import { createService, finishService, isEntry, listen } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';
import { connectDatabase } from './database/connection.js';
import { forecastRouter } from './routes/forecast.js';
import { reportRouter } from './routes/report.js';

export function createApp() {
    const app = createService('analytics');
    app.use('/', forecastRouter);
    app.use('/', reportRouter);
    return finishService(app, 'analytics');
}

if (isEntry(import.meta.url)) {
    await connectDatabase();
    await listen(createApp(), PORTS.analytics, 'analytics');
}
