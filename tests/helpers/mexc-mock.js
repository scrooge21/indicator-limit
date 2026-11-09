import { env } from '../../src/config/env.js';

export const BOOK = {
  bids: [['100', '2'], ['99', '1'], ['90', '10']],
  asks: [['101', '1'], ['104', '2'], ['110', '5']],
};
// price 100, depth 5% -> bids >= 95: 200 + 99 = 299; asks <= 105: 101 + 208 = 309
export const EXPECTED_5PCT = { bidUSD: 299, askUSD: 309 };

export const EXCHANGE_INFO = { symbols: [
  { symbol: 'BTCUSDT', quoteAsset: 'USDT', status: '1' },
  { symbol: 'ETHUSDT', quoteAsset: 'USDT', status: 'ENABLED' },
  { symbol: 'XRPUSDT', quoteAsset: 'USDT', status: '1' },
  { symbol: 'DEADUSDT', quoteAsset: 'USDT', status: '2' },
  { symbol: 'BTCUSDC', quoteAsset: 'USDC', status: '1' },
] };

export const TICKERS_24H = [
  { symbol: 'BTCUSDT', lastPrice: '100', priceChangePercent: '1.5', quoteVolume: '5000' },
  { symbol: 'ETHUSDT', lastPrice: '100', priceChangePercent: '-2', quoteVolume: '9000' },
  { symbol: 'XRPUSDT', lastPrice: '100', priceChangePercent: '0.1', quoteVolume: '7000' },
  { symbol: 'BTCUSDC', lastPrice: '100', priceChangePercent: '0', quoteVolume: '99999' },
];

const KLINES = [
  [1700000000000, '99', '101', '98', '100', '12.5', 1700000059999, '1250'],
  [1700000060000, '100', '102', '99', '101', '8.1', 1700000119999, '810'],
];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Подменяет globalThis.fetch: запросы к MEXC обслуживаются фикстурами, остальные (локальный сервер) идут по-настоящему.
 * handlers: { '/api/v3/depth': (url) => Response | object } — переопределения по pathname.
 */
export function installMexcMock(handlers = {}) {
  const realFetch = globalThis.fetch;
  const mexcHost = new URL(env.mexcBaseUrl).host;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.host !== mexcHost) return realFetch(input, init);
    calls.push(url.pathname + url.search);
    const symbol = url.searchParams.get('symbol');
    const custom = handlers[url.pathname];
    if (custom) { const out = await custom(url); return out instanceof Response ? out : json(out); }
    switch (url.pathname) {
      case '/api/v3/exchangeInfo': return json(EXCHANGE_INFO);
      case '/api/v3/ticker/24hr': return json(TICKERS_24H);
      case '/api/v3/ticker/price':
        if (symbol === 'BADUSDT') return json({ symbol, price: 'not-a-number' });
        if (symbol === 'NOPEUSDT') return json({ code: -1121, msg: 'Invalid symbol' }, 400);
        return json({ symbol, price: '100' });
      case '/api/v3/depth': return json(BOOK);
      case '/api/v3/klines': return json(KLINES);
      default: return json({ msg: 'not mocked' }, 404);
    }
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}
export { json };
