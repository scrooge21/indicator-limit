// ВИ 2.5: фоновый логгер закреплённых пар. История копится и при закрытом интерфейсе.
import { URLS, PINNED_PAIRS } from '../../shared/config.js';
import { getJson, qs } from '../../shared/http.js';
import { windowSums } from '../../shared/imbalance.js';
import { dbReady } from '../../shared/mongo.js';
import { History } from './models/history.js';

const DEPTH_PCT = 5;
let running = false;

export async function logOnce(symbols = PINNED_PAIRS) {
    if (!dbReady() || running) return;      // нет БД или предыдущий проход ещё не закончен
    running = true;
    try {
        for (const symbol of symbols) {
            try {
                const { price, book } = await getJson(`${URLS.market}/snapshot?${qs({ symbol, limit: 1000 })}`);
                await History.create({ symbol, price, ...windowSums(book, price, DEPTH_PCT), depthPct: DEPTH_PCT, source: 'logger' });
            } catch (e) { console.error(`[indicator] logger ${symbol}:`, e.message); }
        }
    } finally { running = false; }
}

export function startLogger(intervalMs = 15000) {
    const timer = setInterval(logOnce, intervalMs);
    timer.unref?.();
    return timer;
}
