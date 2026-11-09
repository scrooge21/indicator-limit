// Кэш списка пар к USDT в памяти сервиса (контекст «Рыночные данные», ВИ 1.1 и 1.5).
export const FALLBACK_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];

export class SymbolCache {
    constructor(ttlMs = 6 * 3600 * 1000) {
        this.ttlMs = ttlMs;
        this.symbols = [];
        this.savedAt = 0;
    }
    get() {
        const fresh = this.symbols.length > 0 && Date.now() - this.savedAt < this.ttlMs;
        return fresh ? this.symbols : null;
    }
    set(symbols) {
        this.symbols = symbols;
        this.savedAt = Date.now();
    }
}
