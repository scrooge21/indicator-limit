// Расчёт индикатора дисбаланса заявок. Чистая функция — без обращений к сети и БД.
// book: { bids: [[price, qty], ...], asks: [[price, qty], ...] } (значения могут быть строками)
export function windowSums(book, price, depthPct) {
    const lo = price * (1 - depthPct / 100);
    const hi = price * (1 + depthPct / 100);
    let bidUSD = 0;
    let askUSD = 0;
    for (const [p, q] of book?.bids ?? []) {
        const pr = parseFloat(p);
        if (pr >= lo) bidUSD += pr * parseFloat(q);
    }
    for (const [p, q] of book?.asks ?? []) {
        const pr = parseFloat(p);
        if (pr <= hi) askUSD += pr * parseFloat(q);
    }
    return { bidUSD, askUSD, imbalance: askUSD > 0 ? bidUSD / askUSD : 0 };
}
