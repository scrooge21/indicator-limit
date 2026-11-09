// Сервис «Сканер» (контекст 4, серверная часть). Порт по умолчанию 3003. Хранилище: scan_snapshots.
import { createService, finishService, isEntry, listen } from '../../shared/service.js';
import { PORTS } from '../../shared/config.js';
import { connectDatabase } from './database/connection.js';
import { scanRouter } from './routes/scan.js';

export function createApp() {
    const app = createService('scanner');
    app.use('/', scanRouter);
    return finishService(app, 'scanner');
}

if (isEntry(import.meta.url)) {
    await connectDatabase();
    await listen(createApp(), PORTS.scanner, 'scanner');
}
