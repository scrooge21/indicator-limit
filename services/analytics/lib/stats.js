// Статистика и прогноз на основе линейной регрессии. Чистые функции, без обращений к сети и БД.

export function describe(ys) {
    const n = ys.length;
    const mean = ys.reduce((s, v) => s + v, 0) / n;
    const variance = ys.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return { count: n, mean, min: Math.min(...ys), max: Math.max(...ys), last: ys[n - 1], std: Math.sqrt(variance) };
}

// МНК-прямая y = intercept + slope * i, где i = 0..n-1 (номер точки ряда)
export function linearRegression(ys) {
    const n = ys.length;
    if (n < 2) throw new Error('Для регрессии нужно минимум 2 точки');
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    const mean = sy / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        ssRes += (ys[i] - (intercept + slope * i)) ** 2;
        ssTot += (ys[i] - mean) ** 2;
    }
    return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

// Прогноз на horizon шагов вперёд: продолжение прямой за последней точкой
export function forecastLinear(ys, horizon) {
    const model = linearRegression(ys);
    const n = ys.length;
    const values = Array.from({ length: horizon }, (_, k) => model.intercept + model.slope * (n + k));
    return { model, values };
}

// Направление тренда: относительное изменение прямой за весь ряд (порог 2%)
export function trendDirection(model, n, mean, threshold = 0.02) {
    const change = model.slope * (n - 1);
    const rel = change / (Math.abs(mean) || 1);
    return rel > threshold ? 'up' : rel < -threshold ? 'down' : 'flat';
}
