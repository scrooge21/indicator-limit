import { env } from '../config/env.js';

async function request(path, params = {}) {
  const url = new URL(path, env.mexcBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(env.requestTimeoutMs), headers: { accept: 'application/json' } });
  } catch (cause) {
    const error = new Error(cause.name === 'TimeoutError' ? 'MEXC request timed out' : 'Unable to reach MEXC API');
    error.status = cause.name === 'TimeoutError' ? 504 : 502;
    throw error;
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.msg || body?.message || `MEXC returned HTTP ${response.status}`;
    const error = new Error(message); error.status = 502; throw error;
  }
  if (body && !Array.isArray(body) && typeof body === 'object' && body.code && Number(body.code) !== 0) {
    throw new Error(body.msg || `MEXC error ${body.code}`);
  }
  return body;
}

export const mexcService = {
  exchangeInfo: () => request('/api/v3/exchangeInfo'),
  symbols: () => request('/api/v3/exchangeInfo'),
  tickerPrice: (symbol) => request('/api/v3/ticker/price', { symbol }),
  ticker24hr: () => request('/api/v3/ticker/24hr'),
  depth: (symbol, limit = 1000) => request('/api/v3/depth', { symbol, limit }),
  klines: (symbol, interval = '1m', limit = 200) => request('/api/v3/klines', { symbol, interval, limit }),
};

export function calculateLiquidity(book, price, depthPct = 5) {
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  const asks = Array.isArray(book?.asks) ? book.asks : [];
  const bidUSD = bids.reduce((sum, [p, q]) => Number(p) >= price * (1 - depthPct / 100) ? sum + Number(p) * Number(q) : sum, 0);
  const askUSD = asks.reduce((sum, [p, q]) => Number(p) <= price * (1 + depthPct / 100) ? sum + Number(p) * Number(q) : sum, 0);
  return { bidUSD, askUSD, imbalance: askUSD > 0 ? bidUSD / askUSD : 0 };
}
