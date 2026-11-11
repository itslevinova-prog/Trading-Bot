export function ema(values, period) { if (values.length < period)
    return []; const k = 2 / (period + 1); const out = []; let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period; out[period - 1] = e; for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
} return out; }
export function rsi(closes, period = 14) { if (closes.length <= period)
    return NaN; let gain = 0, loss = 0; for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
} gain /= period; loss /= period; for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
} return loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss); }
export function atr(candles, period = 14) { if (candles.length <= period)
    return NaN; const tr = []; for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
} let a = tr.slice(0, period).reduce((x, y) => x + y, 0) / period; for (const val of tr.slice(period))
    a = (a * (period - 1) + val) / period; return a; }
export function feature(pair, c15, c60, ticker, now = Date.now()) {
    const a = c15.filter(c => c.ts + 15 * 60000 <= now).sort((a, b) => a.ts - b.ts);
    const b = c60.filter(c => c.ts + 60 * 60000 <= now).sort((a, b) => a.ts - b.ts);
    if (a.length < 60 || b.length < 51 || !ticker.bid || !ticker.ask)
        return undefined;
    const contiguous = (rows, count, step) => rows.slice(-count).every((c, i, tail) => i === 0 || c.ts - tail[i - 1].ts === step);
    if (!contiguous(a, 60, 900000) || !contiguous(b, 51, 3600000) || now - a.at(-1).ts - 900000 > 20 * 60000 || now - b.at(-1).ts - 3600000 > 75 * 60000 || ticker.ask < ticker.bid)
        return undefined;
    const closes = a.map(c => c.close), hour = b.map(c => c.close), e20 = ema(closes, 20), e50 = ema(closes, 50), e60 = ema(hour, 50);
    const current = a.at(-1), prev = a.at(-2), m = closes.length - 1;
    const change = (back) => closes.length > back ? (current.close / closes[m - back] - 1) * 100 : 0;
    const atrVal = atr(a);
    const avg = a.slice(-21, -1).reduce((v, c) => v + c.volume, 0) / 20;
    return { pair, ts: current.ts, ema20: e20[m], ema50: e50[m], ema50_60m: e60.at(-1), prevEma20: e20[m - 1], prevEma50: e50[m - 1], rsi14: rsi(closes), atr14: atrVal, atrPct: atrVal / current.close * 100, volumeRatio: avg > 0 ? current.volume / avg : 0, change1h: change(4), change4h: change(16), change24h: change(96), spreadPct: 100 * (ticker.ask - ticker.bid) / ((ticker.ask + ticker.bid) / 2), distanceEma50Pct: (current.close / e50[m] - 1) * 100, price: current.close };
}
