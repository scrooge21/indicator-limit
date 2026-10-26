// Получение временного ряда у сервиса «Индикатор и история».
import { URLS } from '../../../shared/config.js';
import { getJson, qs } from '../../../shared/http.js';

export function pickBucket(hours, requested) {
    const b = parseInt(requested);
    if (b > 0) return b;
    return Math.max(60, Math.ceil((hours * 3600) / 360));   // не более ~360 точек
}

export async function loadSeries(symbol, hours, bucket) {
    const since = Math.floor(Date.now() / 1000) - hours * 3600;
    const rows = await getJson(`${URLS.indicator}/history?${qs({ symbol, since, bucket, limit: 5000 })}`, { timeoutMs: 15000 });
    return Array.isArray(rows) ? rows : [];
}
