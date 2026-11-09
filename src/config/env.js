import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
config({ path: path.join(rootDir, '.env'), quiet: true });

const num = (value, fallback) => (value === undefined || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value));

export const env = {
  port: num(process.env.PORT, 10000),
  mongoUri: process.env.MONGODB_URI || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',                          // ключ для ручной записи POST /api/history; пусто — запись отключена
  mexcBaseUrl: process.env.MEXC_BASE_URL || 'https://api.mexc.com',
  requestTimeoutMs: num(process.env.MEXC_TIMEOUT_MS, 10000),
  // --- история индикатора ---
  historyTtlSeconds: num(process.env.HISTORY_TTL_SECONDS, 604800),      // хранить в MongoDB не дольше 7 суток
  historyMinIntervalMs: num(process.env.HISTORY_MIN_INTERVAL_MS, 5000), // не чаще 1 записи на символ за N мс
  historyMaxDocs: num(process.env.HISTORY_MAX_DOCS, 400000),            // жёсткий лимит документов в MongoDB
  historyMemoryPerSymbol: num(process.env.HISTORY_MEMORY_PER_SYMBOL, 20000), // кольцевой буфер в RAM
  historyPruneIntervalMs: num(process.env.HISTORY_PRUNE_INTERVAL_MS, 600000),
  historyDepthPct: 5,                                                    // глубина стакана для сохраняемых BID/ASK
  logIntervalMs: num(process.env.LOG_INTERVAL_MS, 15000),
  watchMaxSymbols: num(process.env.WATCH_MAX_SYMBOLS, 10),              // сколько «просмотренных» пар писать в фоне
  watchTtlMs: num(process.env.WATCH_TTL_MS, 86400000),                  // перестать писать пару, если её не открывали 24 ч
};
export { rootDir };
