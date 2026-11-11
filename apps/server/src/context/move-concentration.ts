import type {Candle} from '@paper/shared';
import {CONTEXT_STEP_MS,metricWindows} from './window-metrics.js';

const EDGES = 16;

/** Closed four-hour path concentration for research and explanation. */
export function closedMoveConcentration(bars: readonly Candle[], pair: string, now: number) {
    const closedAt = metricWindows(now).last24h.toExclusive;
    const start = closedAt - (EDGES + 1) * CONTEXT_STEP_MS;
    const window = bars.filter(b => b.pair === pair && b.interval === 15 && b.ts >= start && b.ts < closedAt)
        .sort((a, b) => a.ts - b.ts);
    const valid = window.length === EDGES + 1 && window.every((bar, i) =>
        bar.ts === start + i * CONTEXT_STEP_MS && Number.isFinite(bar.close) && bar.close > 0);
    const evidence = {version: 'closed-move-concentration-v1', closedAt, edges: EDGES};
    if (!valid) return {...evidence, complete: false, largestMoveShare: null, upMoves: null, downMoves: null};

    const logs = window.map(b => Math.log(b.close));
    const moves = logs.slice(1).map((price, i) => price - logs[i]!);
    const absolute = moves.map(Math.abs);
    const path = absolute.reduce((sum, move) => sum + move, 0);
    return {
        ...evidence,
        complete: true,
        largestMoveShare: path > 0 ? Math.max(...absolute) / path : null,
        upMoves: moves.filter(v => v > 0).length,
        downMoves: moves.filter(v => v < 0).length,
    };
}
