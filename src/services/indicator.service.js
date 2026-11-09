import { mexcService } from './mexc.service.js';
import * as ind from './indicators.js';

// Сколько свечей запрашиваем у MEXC для прогрева индикаторов (максимум API) и сколько отдаём по умолчанию.
export const WARMUP_CANDLES = 500;
export const DEFAULT_OUTPUT = 200;
export const MAX_INDICATORS_PER_REQUEST = 8;

const fail = (message, status = 400) => { const e = new Error(message); e.status = status; return e; };

// Каталог доступных индикаторов. placement: overlay — поверх свечей, pane — отдельная панель под графиком.
export const CATALOG = [
  { id: 'ema20', label: 'EMA 20', group: 'Тренд', placement: 'overlay', intervals: null, description: 'Экспоненциальная скользящая средняя, период 20.' },
  { id: 'sma50', label: 'SMA 50', group: 'Тренд', placement: 'overlay', intervals: null, description: 'Простая скользящая средняя, период 50.' },
  { id: 'sma200', label: 'SMA 200', group: 'Тренд', placement: 'overlay', intervals: null, description: 'Простая скользящая средняя, период 200.' },
  { id: 'bollinger', label: 'Bollinger (20, 2)', group: 'Волатильность', placement: 'overlay', intervals: null, description: 'Полосы Боллинджера: SMA 20 ± 2 стандартных отклонения.' },
  { id: 'dema_atr', label: 'DEMA ATR Channels (40/15)', group: 'Rinar', placement: 'overlay', intervals: null, description: 'Каналы DEMA ± ATR из проекта rinar_bot: быстрая/медленная DEMA и границы ±2, ±3 ATR.' },
  { id: 'rinar', label: 'Rinar: уровни и дивергенция', group: 'Rinar', placement: 'overlay', intervals: ['1d'], description: 'Фундаментальная линия, RSI-поддержки 25D/14W, жёлтая, фиолетовая, оранжевая и красная зоны; метки медвежьей дивергенции MACD 64/270/9. Только дневной таймфрейм.' },
  { id: 'rsi14', label: 'RSI 14', group: 'Осцилляторы', placement: 'pane', intervals: null, description: 'RSI по Уайлдеру (как ta.rsi в Pine), уровни 30 и 70.' },
  { id: 'macd', label: 'MACD (12, 26, 9)', group: 'Осцилляторы', placement: 'pane', intervals: null, description: 'Линия MACD, сигнальная линия и гистограмма.' },
];
const BY_ID = new Map(CATALOG.map(item => [item.id, item]));

const line = (key, label, color, values, times, extra = {}) => ({
  key, label, color, ...extra,
  points: times.map((time, i) => ({ time, value: values[i] })).filter(p => Number.isFinite(p.value)),
});

// Свечи MEXC: [openTime, open, high, low, close, volume, closeTime, quoteVolume] → колонки.
export function parseCandles(rows) {
  const out = { times: [], open: [], high: [], low: [], close: [], volume: [] };
  for (const r of Array.isArray(rows) ? rows : []) {
    const v = [Number(r[0]) / 1000, Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])];
    if (!v.every(Number.isFinite)) continue;
    out.times.push(Math.floor(v[0])); out.open.push(v[1]); out.high.push(v[2]); out.low.push(v[3]); out.close.push(v[4]); out.volume.push(v[5]);
  }
  return out;
}

const COLORS = { ema: '#38bdf8', sma50: '#f59e0b', sma200: '#a78bfa', band: '#64748b' };

const builders = {
  ema20: (c, t) => ({ lines: [line('ema20', 'EMA 20', COLORS.ema, ind.ema(c.close, 20), t)] }),
  sma50: (c, t) => ({ lines: [line('sma50', 'SMA 50', COLORS.sma50, ind.sma(c.close, 50), t)] }),
  sma200: (c, t) => ({ lines: [line('sma200', 'SMA 200', COLORS.sma200, ind.sma(c.close, 200), t)] }),
  bollinger: (c, t) => {
    const b = ind.bollinger(c.close, 20, 2);
    return { lines: [
      line('upper', 'BB верх', COLORS.band, b.upper, t), line('mid', 'BB середина', '#94a3b8', b.mid, t, { style: 'dashed' }),
      line('lower', 'BB низ', COLORS.band, b.lower, t),
    ] };
  },
  dema_atr: (c, t) => {
    const d = ind.demaAtrLevels(c, 40, 15);
    return { lines: [
      line('dema_p3', 'DEMA +3 ATR (закрытие остатка)', '#ef4444', d.p3, t), line('dema_p2', 'DEMA +2 ATR', '#f97316', d.p2, t),
      line('fast', 'Быстрая DEMA 40', '#38bdf8', d.fast, t), line('slow', 'Медленная DEMA 15', '#e2e8f0', d.slow, t, { style: 'dashed' }),
      line('dema_m2', 'DEMA −2 ATR (старт покупок)', '#f8fafc', d.m2, t), line('dema_m3', 'DEMA −3 ATR', '#eab308', d.m3, t),
    ] };
  },
  rinar: (c, t) => {
    const lv = ind.rinarLevels(c);
    const div = ind.bearishDivergence(c);
    const markers = t.map((time, i) => (div[i] ? { time, position: 'aboveBar', shape: 'arrowDown', color: '#ef4444', text: 'Div' } : null)).filter(Boolean);
    return {
      lines: [
        line('red', 'Красная (×11.4)', '#ef4444', lv.red, t), line('orange', 'Оранжевая (×5.07)', '#f97316', lv.orange, t),
        line('purple', 'Фиолетовая (×2.255)', '#a855f7', lv.purple, t), line('yellow', 'Жёлтая (SMA100×0.51)', '#eab308', lv.yellow, t),
        line('fund', 'Зелёная (фундаментальная)', '#22c55e', lv.fund, t), line('rsi25', 'RSI 25D поддержка', '#60a5fa', lv.rsi25, t, { style: 'dashed' }),
        line('rsi14w', 'RSI 14W поддержка', '#e2e8f0', lv.rsi14w, t, { style: 'dashed' }),
      ],
      markers,
    };
  },
  rsi14: (c, t) => ({ lines: [line('rsi', 'RSI 14', '#a78bfa', ind.rsi(c.close, 14), t)], levels: [30, 70], range: [0, 100] }),
  macd: (c, t) => {
    const m = ind.macd(c.close, 12, 26, 9);
    return {
      lines: [line('macd', 'MACD', '#38bdf8', m.macd, t), line('signal', 'Сигнал', '#f59e0b', m.signal, t)],
      histogram: t.map((time, i) => ({ time, value: m.hist[i], color: m.hist[i] >= 0 ? 'rgba(0,229,146,0.5)' : 'rgba(255,73,118,0.5)' })).filter(p => Number.isFinite(p.value)),
    };
  },
};

// Проверка списка индикаторов и их совместимости с таймфреймом (ошибки — 400).
export function resolveIndicators(names, interval) {
  const unique = [...new Set(names)];
  if (!unique.length) throw fail('names must contain at least one indicator');
  if (unique.length > MAX_INDICATORS_PER_REQUEST) throw fail(`at most ${MAX_INDICATORS_PER_REQUEST} indicators per request`);
  for (const name of unique) {
    const item = BY_ID.get(name);
    if (!item) throw fail(`Unknown indicator: ${name}`);
    if (item.intervals && !item.intervals.includes(interval)) throw fail(`Indicator ${name} is available only on ${item.intervals.join(', ')}`);
  }
  return unique;
}

// Считает индикаторы по свечам и оставляет последние `limit` баров (остальное — прогрев).
export function computeIndicators(candles, names, limit = DEFAULT_OUTPUT) {
  const result = {};
  const keepFrom = Math.max(0, candles.times.length - limit);
  const cut = (arr) => arr.filter(p => p.time >= (candles.times[keepFrom] ?? 0));
  for (const name of names) {
    const built = builders[name](candles, candles.times);
    result[name] = {
      id: name, placement: BY_ID.get(name).placement,
      lines: built.lines.map(l => ({ ...l, points: cut(l.points) })),
      ...(built.histogram ? { histogram: cut(built.histogram) } : {}),
      ...(built.markers ? { markers: cut(built.markers) } : {}),
      ...(built.levels ? { levels: built.levels } : {}),
      ...(built.range ? { range: built.range } : {}),
    };
  }
  return result;
}

export async function getIndicators({ symbol, interval, names, limit = DEFAULT_OUTPUT }) {
  const resolved = resolveIndicators(names, interval);
  const candles = parseCandles(await mexcService.klines(symbol, interval, WARMUP_CANDLES));
  return { symbol, interval, candles: candles.times.length, indicators: computeIndicators(candles, resolved, limit) };
}
