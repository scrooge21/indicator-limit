// Сервис «Рыночные данные» (контекст 1). Порт по умолчанию 3001. База данных не используется.
import { createService, finishService, isEntry, listen } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';
import { marketRouter } from './routes/market.js';

export function createApp() {
    const app = createService('market-data');
    app.use('/', marketRouter);
    return finishService(app, 'market-data');
}

if (isEntry(import.meta.url)) listen(createApp(), PORTS.market, 'market-data');
