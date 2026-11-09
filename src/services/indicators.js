// Чистые функции расчёта индикаторов (без сети и состояния). Все функции принимают и возвращают массивы
// одинаковой длины; значение NaN означает «индикатор ещё не определён на этом баре».
// Rinar и DEMA ATR — порт из Python-проекта rinar_bot (rinar/indicators.py, rinar/dema_atr.py).

const nanArray = (n) => new Array(n).fill(NaN);

// pandas: Series.ewm(alpha=a, adjust=False).mean()
export function ewmAlpha(values, alpha) {
  const out = nanArray(values.length);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (Number.isNaN(x)) { out[i] = prev; continue; }
    prev = Number.isNaN(prev) ? x : alpha * x + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

// pandas: Series.ewm(span=n, adjust=False).mean()
export const ema = (values, span) => ewmAlpha(values, 2 / (Math.max(1, span) + 1));
// Wilder RMA: ewm(alpha=1/n)
export const rma = (values, len) => ewmAlpha(values, 1 / Math.max(1, len));

// pandas: rolling(len, min_periods).mean()
export function sma(values, len, minPeriods = len) {
  const n = Math.max(1, Math.floor(len));
  const out = nanArray(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    const count = Math.min(i + 1, n);
    if (count >= minPeriods) out[i] = sum / count;
  }
  return out;
}

export function dema(values, len) {
  const e1 = ema(values, len);
  const e2 = ema(e1, len);
  return e1.map((v, i) => 2 * v - e2[i]);
}

// VWMA = sum(close*volume) / sum(volume) за окно, min_periods=1 (как в rinar_bot)
export function vwma(close, volume, len) {
  const n = Math.max(1, Math.floor(len));
  const out = nanArray(close.length);
  let pv = 0, v = 0;
  for (let i = 0; i < close.length; i++) {
    pv += close[i] * volume[i]; v += volume[i];
    if (i >= n) { pv -= close[i - n] * volume[i - n]; v -= volume[i - n]; }
    out[i] = pv / Math.max(v, 1e-12);
  }
  return out;
}

// RSI как ta.rsi в Pine: Wilder RMA с затравкой SMA (rinar/breadth.py: rsi_pine)
export function rsi(close, length = 14) {
  const n = close.length;
  const out = nanArray(n);
  if (n <= length) return out;
  const up = [], dn = [];
  for (let i = 1; i < n; i++) { const d = close[i] - close[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  let au = 0, ad = 0;
  for (let i = 0; i < length; i++) { au += up[i]; ad += dn[i]; }
  au /= length; ad /= length;
  const val = (a, b) => (b === 0 ? 100 : a === 0 ? 0 : 100 - 100 / (1 + a / b));
  out[length] = val(au, ad);
  for (let k = length; k < n - 1; k++) {
    au = (au * (length - 1) + up[k]) / length;
    ad = (ad * (length - 1) + dn[k]) / length;
    out[k + 1] = val(au, ad);
  }
  return out;
}

export function macd(close, fast = 12, slow = 26, signal = 9) {
  const f = ema(close, fast), s = ema(close, slow);
  const line = f.map((v, i) => v - s[i]);
  const sig = ema(line, signal);
  return { macd: line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

// Полосы Боллинджера: SMA(len) ± mult * стандартное отклонение (популяционное, как в TradingView)
export function bollinger(close, len = 20, mult = 2) {
  const mid = sma(close, len);
  const upper = nanArray(close.length), lower = nanArray(close.length);
  for (let i = len - 1; i < close.length; i++) {
    let sq = 0;
    for (let j = i - len + 1; j <= i; j++) sq += (close[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sq / len);
    upper[i] = mid[i] + mult * sd; lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function trueRange(high, low, close) {
  return high.map((h, i) => {
    const hl = h - low[i];
    if (i === 0) return hl;
    return Math.max(hl, Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  });
}
export const atr = (high, low, close, len = 14) => rma(trueRange(high, low, close), len);

// ---------------------------------------------------------------- Rinar (только дневной таймфрейм)

// Линия «RSI-поддержка»: цена, при которой RSI(length) равен level (rinar/indicators.py: rsi_band_pine)
export function rsiBand(close, length, level) {
  const n = close.length;
  if (n < 2) return nanArray(n);
  const up = [0], dn = [0];
  for (let i = 1; i < n; i++) { const d = close[i] - close[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
  const alpha = 2 / (2 * length - 1 + 1);
  const auc = ewmAlpha(up, alpha), adc = ewmAlpha(dn, alpha);
  const ratio = level / (100 - level);
  return close.map((c, i) => {
    const x = (length - 1) * (adc[i] * ratio - auc[i]);
    return x >= 0 ? c + x : c + (x * (100 - level)) / level;
  });
}

const DAY_MS = 86400000;
// Конец недели (воскресенье, UTC) для времени открытия дневной свечи — аналог pandas resample('W-SUN')
const weekEnd = (timeSec) => {
  const day = Math.floor((timeSec * 1000) / DAY_MS);          // дни от эпохи; 1970-01-01 — четверг
  const dow = (day + 4) % 7;                                   // 0 = воскресенье
  return day + ((7 - dow) % 7);
};

// Недельная RSI-поддержка, протянутая на дневные бары; значение берётся по прошлой неделе (shift(1)).
export function weeklyRsiSupport(timesSec, close, length = 14, level = 30) {
  const labels = [], wkClose = [];
  timesSec.forEach((t, i) => {
    const label = weekEnd(t);
    if (labels.length && labels[labels.length - 1] === label) wkClose[wkClose.length - 1] = close[i];
    else { labels.push(label); wkClose.push(close[i]); }
  });
  const band = rsiBand(wkClose, length, level);
  const shifted = band.map((_, k) => (k === 0 ? NaN : band[k - 1]));
  const out = nanArray(close.length);
  let k = 0;
  timesSec.forEach((t, i) => {
    const day = Math.floor((t * 1000) / DAY_MS);
    while (k + 1 < labels.length && labels[k + 1] <= day) k++;
    out[i] = labels[k] <= day ? shifted[k] : NaN;
  });
  return out;
}

export const RINAR_DEFAULTS = {
  redMult: 11.4, vwmaLen: 100, sma350Len: 350, sma100Len: 100, rsi25Len: 25, rsi14wLen: 14,
  vwmaMult: 0.535, sma350Mult: 0.816, yellowMult: 0.51, purpleMult: 2.255, orangeMult: 5.07, rsiLevel: 30,
};

export function rinarLevels({ times, close, volume }, opts = {}) {
  const p = { ...RINAR_DEFAULTS, ...opts };
  const emm = vwma(close, volume, p.vwmaLen).map(v => v * p.vwmaMult);
  const asma = sma(close, p.sma350Len, 1).map(v => v * p.sma350Mult);
  const fund = emm.map((v, i) => Math.min(v, asma[i]));
  const sma100 = sma(close, p.sma100Len, 1);
  return {
    fund,
    rsi25: rsiBand(close, p.rsi25Len, p.rsiLevel),
    rsi14w: weeklyRsiSupport(times, close, p.rsi14wLen, p.rsiLevel),
    yellow: sma100.map(v => v * p.yellowMult),
    purple: fund.map(v => v * p.purpleMult),
    orange: fund.map(v => v * p.orangeMult),
    red: fund.map(v => v * p.redMult),
  };
}

// Медвежья дивергенция MACD 64/270/9 (rinar/indicators.py: bearish_divergence).
// Возвращает массив boolean: сигнал на баре i подтверждается через `lookback` баров после пика гистограммы.
export function bearishDivergence({ high, close }, fast = 64, slow = 270, sig = 9, lookback = 5, maxBars = 100) {
  const { hist } = macd(close, fast, slow, sig);
  const n = close.length;
  const out = new Array(n).fill(false);
  let prevBar = null, prevHist = null, prevPrice = null;
  for (let i = lookback * 2; i < n; i++) {
    const p = i - lookback;
    let max = -Infinity, ties = 0, hasNaN = false;
    for (let j = p - lookback; j <= p + lookback; j++) {
      const h = hist[j];
      if (Number.isNaN(h)) { hasNaN = true; break; }
      if (h > max) max = h;
    }
    if (hasNaN || hist[p] !== max) continue;
    for (let j = p - lookback; j <= p + lookback; j++) if (hist[j] === hist[p]) ties++;
    if (ties > 1) continue;
    if (prevBar !== null && p - prevBar <= maxBars && high[p] > prevPrice && hist[p] < prevHist) out[i] = true;
    prevBar = p; prevHist = hist[p]; prevPrice = high[p];
  }
  return out;
}

// ---------------------------------------------------------------- DEMA ATR Channels (rinar/dema_atr.py)
export function demaAtrLevels({ high, low, close }, fastLen = 40, slowLen = 15) {
  const a = atr(high, low, close, slowLen);
  const slow = dema(close, slowLen), fast = dema(close, fastLen);
  const band = (k) => slow.map((v, i) => v + k * a[i]);
  return { fast, slow, atr: a, p1: band(1), p2: band(2), p3: band(3), m1: band(-1), m2: band(-2), m3: band(-3) };
}
