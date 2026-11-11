import {describe,it,expect} from 'vitest';
import {analyzeRobustness,wilsonLowerBound,bootstrapReturns} from '../src/research/robustness.js';
import {assessSignalQuality,safePositionBudget} from '../src/strategy/quality.js';
import {runResearch,type ResearchCandle} from '../src/research/backtest.js';
const bars=(count=2200):ResearchCandle[]=>Array.from({length:count},(_,i)=>{const close=100+Math.sin(i/18)*3+i*.03,open=100+Math.sin((i-1)/18)*3+(i-1)*.03;return {ts:1_700_000_100_000+i*900000,open,high:Math.max(open,close)+.7,low:Math.min(open,close)-.7,close,volume:120+(i%20)*6};});
const request={strategy:'quality' as const,startingBalance:100,feeRate:.008,slippagePct:.0008};
const f={pair:'BTC/EUR',ts:0,ema20:101,ema50:100,prevEma20:99,prevEma50:100,ema50_60m:95,rsi14:58,atr14:2,atrPct:2,volumeRatio:1.6,change1h:1,change4h:2,change24h:3,spreadPct:.1,distanceEma50Pct:2,price:102};
describe('V0.3 research validation',()=>{
 it('is conservative with short samples',()=>{expect(wilsonLowerBound(1,1)).toBeLessThan(.3);expect(wilsonLowerBound(0,0)).toBeNull();});
 it('never treats insufficient trade history as reliable evidence',()=>{const constant=bars().map(x=>({...x,open:100,close:100,high:100.1,low:99.9,volume:100}));const r=analyzeRobustness(constant,request);expect(r.verdict).toBe('too_little_data');expect(r.historicalWinRatePct).toBeNull();});
 it('splits chronologically without leaking future changes',()=>{const b=bars(),first=analyzeRobustness(b,request),second=analyzeRobustness(b.map((x,i)=>i>2000?{...x,close:x.close*1.02,high:x.high*2}:x),request);expect(first.folds[0]).toEqual(second.folds[0]);expect(first.folds[0]!.to).toBeLessThan(first.folds[1]!.from);});
 it('reports missing candles',()=>{const r=analyzeRobustness(bars().filter((_,i)=>i<1400||i>=1475),request);expect(r.missingBars).toBeGreaterThan(70);expect(r.verdict).toBe('too_little_data');});
 it('keeps repeatable bootstrap and proper nominal risk sizing',()=>{const trades=Array.from({length:35},(_,i)=>({pnlPct:i%3?2:-4}));expect(bootstrapReturns(trades)).toEqual(bootstrapReturns(trades));expect(safePositionBudget(100,.05)).toBe(15);});
 it('rejects expensive or overheated markets and never auto-trades',()=>{expect(assessSignalQuality(f,.008).passed).toBe(true);expect(assessSignalQuality({...f,rsi14:90},.008).passed).toBe(false);expect(assessSignalQuality(f,.05).passed).toBe(false);const res=runResearch('BTC/EUR',bars(500),request);expect(res.strategy).toBe('quality');});
});
