// Вспомогательные серверы для тестов: эмуляция API биржи MEXC и заглушка сервиса истории.
import http from 'http';

export function startServer(handler, port) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://x');
            const out = handler(url);
            res.writeHead(out ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out ?? { error: 'not found' }));
        });
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

// Эмуляция публичных методов MEXC
export function mexcMock(url) {
    const p = url.pathname;
    const symbol = url.searchParams.get('symbol');
    if (p === '/api/v3/exchangeInfo') {
        return { symbols: [
            { symbol: 'BTCUSDT', quoteAsset: 'USDT' },
            { symbol: 'ETHUSDT', quoteAsset: 'USDT' },
            { symbol: 'ETHBTC',  quoteAsset: 'BTC' }
        ] };
    }
    if (p === '/api/v3/ticker/price') return { symbol, price: '100.0' };
    if (p === '/api/v3/depth') {
        // цена 100: покупки 99 (10 шт.) и 90 (5 шт.), продажи 101 (5 шт.) и 120 (7 шт.)
        return { bids: [['99', '10'], ['90', '5']], asks: [['101', '5'], ['120', '7']] };
    }
    if (p === '/api/v3/klines') return [[1700000000000, '99', '101', '98', '100', '12.5']];
    if (p === '/api/v3/ticker/24hr') {
        return [
            { symbol: 'BTCUSDT', lastPrice: '100.0', priceChangePercent: '1.5', quoteVolume: '5000' },
            { symbol: 'ETHUSDT', lastPrice: '100.0', priceChangePercent: '-0.5', quoteVolume: '9000' },
            { symbol: 'ETHBTC',  lastPrice: '0.05',  priceChangePercent: '0',    quoteVolume: '99999' }
        ];
    }
    return null;
}
