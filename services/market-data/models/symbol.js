// Нормализация и проверка входных параметров (защита от некорректных URL).
export function normalizeSymbol(value, def = 'BTCUSDT') {
    const s = String(value || def).toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(s)) {
        const err = new Error('Некорректное название пары');
        err.status = 400;
        throw err;
    }
    return s;
}

export function normalizeInterval(value, def = '1m') {
    const s = String(value || def);
    if (!/^[0-9]{1,2}[a-zA-Z]$/.test(s)) {
        const err = new Error('Некорректный таймфрейм');
        err.status = 400;
        throw err;
    }
    return s;
}
