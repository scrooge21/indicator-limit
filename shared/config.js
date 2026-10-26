// Общая конфигурация всех сервисов. Значения берутся из переменных окружения (.env).
import { config } from 'dotenv';
config({ quiet: true });

const num = (value, def) => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(n) ? n : def;
};

export const MEXC_BASE_URL = process.env.MEXC_BASE_URL || 'https://api.mexc.com';
export const MONGODB_URI   = process.env.MONGODB_URI || '';
export const HOST          = process.env.HOST || '127.0.0.1';

export const PORTS = {
    gateway:   num(process.env.PORT, 10000),
    market:    num(process.env.MARKET_PORT, 3001),
    indicator: num(process.env.INDICATOR_PORT, 3002),
    scanner:   num(process.env.SCANNER_PORT, 3003),
    analytics: num(process.env.ANALYTICS_PORT, 3004),
};

// Адреса, по которым сервисы обращаются друг к другу
export const URLS = {
    market:    process.env.MARKET_URL    || `http://127.0.0.1:${PORTS.market}`,
    indicator: process.env.INDICATOR_URL || `http://127.0.0.1:${PORTS.indicator}`,
    scanner:   process.env.SCANNER_URL   || `http://127.0.0.1:${PORTS.scanner}`,
    analytics: process.env.ANALYTICS_URL || `http://127.0.0.1:${PORTS.analytics}`,
};

export const PINNED_PAIRS = (process.env.PINNED_PAIRS || 'BTCUSDT,ETHUSDT,SOLUSDT')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

export const HISTORY_TTL_SECONDS = 7 * 24 * 3600;   // 7 суток
