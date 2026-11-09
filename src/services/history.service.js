import { env } from '../config/env.js';
import { MemoryHistoryStore } from './history.store.js';

export const PINNED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

// Запись всегда идёт в RAM-буфер (ограниченный, работает без БД) и, если подключена, в MongoDB.
const memory = new MemoryHistoryStore({ maxPerSymbol: env.historyMemoryPerSymbol });
let persistent = null; // { store, isReady }
const lastWrite = new Map();
const watched = new Map();

export function attachPersistentStore(store, isReady) { persistent = { store, isReady }; }
export function detachPersistentStore() { persistent = null; }
const persistentReady = () => Boolean(persistent && persistent.isReady());

export function resetHistoryState() { memory.clear(); lastWrite.clear(); watched.clear(); persistent = null; }

/** Пишет точку не чаще historyMinIntervalMs на символ. Возвращает true, если запись выполнена. */
export async function recordSample(sample, now = Date.now()) {
  if (now - (lastWrite.get(sample.symbol) ?? -Infinity) < env.historyMinIntervalMs) return false;
  lastWrite.set(sample.symbol, now);
  const doc = { timestamp: new Date(now), ...sample };
  await memory.add(doc);
  if (persistentReady()) persistent.store.add(doc).catch(error => console.error('History write failed:', error.message));
  return true;
}

/**
 * Ручное добавление точки (POST /api/history). Троттлинг не применяется.
 * Если MongoDB подключена — ждём подтверждения записи в БД (ошибка → 502), иначе точка остаётся только в памяти.
 */
export async function addManualSample(sample) {
  const doc = { ...sample };
  const toDb = persistentReady();
  if (toDb) {
    try { await persistent.store.add(doc); }
    catch (cause) { console.error('Manual history write failed:', cause.message); const e = new Error('Failed to write to the database'); e.status = 502; throw e; }
  }
  await memory.add(doc);
  return { stored: toDb ? persistent.store.name : memory.name, point: doc };
}

export async function getHistory(params) {
  if (persistentReady()) {
    try {
      const rows = await persistent.store.query(params);
      if (rows.length) return { source: persistent.store.name, rows };
    } catch (error) { console.error('History read failed, using memory:', error.message); }
  }
  return { source: memory.name, rows: await memory.query(params) };
}

/** Пара, которую открыл пользователь, продолжает писаться в фоне — иначе в истории образуются «дыры». */
export function watchSymbol(symbol, now = Date.now()) {
  if (PINNED_SYMBOLS.includes(symbol)) return;
  watched.delete(symbol); watched.set(symbol, now);
  while (watched.size > env.watchMaxSymbols) watched.delete(watched.keys().next().value);
}

export function getTrackedSymbols(now = Date.now()) {
  for (const [symbol, seen] of watched) if (now - seen > env.watchTtlMs) watched.delete(symbol);
  return [...PINNED_SYMBOLS, ...watched.keys()];
}

export async function pruneHistory() {
  if (!persistentReady()) return 0;
  try { return await persistent.store.prune(); } catch (error) { console.error('History prune failed:', error.message); return 0; }
}

export async function historyStats() {
  return {
    store: persistentReady() ? persistent.store.name : memory.name,
    persistent: persistentReady(),
    memorySamples: await memory.count(),
    tracked: getTrackedSymbols(),
  };
}
