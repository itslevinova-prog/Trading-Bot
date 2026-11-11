import type {Candle} from './candle-source.js';
export type FillModelName = 'conservative-ohlc' | 'synthetic-bid' | 'maker-queue';
export type ExitReason = 'stop' | 'target' | 'signal';
export interface FillQuote { price: number; spreadCost: number; slippageCost: number }
export interface FillModel {
  readonly name: FillModelName;
  readonly spreadBps: number;
  readonly slippageBps: number;
  entry(candle: Candle, side: 'buy'|'sell'): FillQuote;
  exit(candle: Candle, stop: number | null, target: number | null): {reason: 'stop'|'target'; quote: FillQuote} | null;
}
export interface FillParameters { spreadBps?: number; slippageBps?: number }
/** Deterministic synthetic half-spread and price-adverse slippage; no free best-case fills. */
export class ConservativeOhlcModel implements FillModel {
  readonly name: FillModelName = 'conservative-ohlc';
  readonly spreadBps: number;
  readonly slippageBps: number;
  constructor(params: FillParameters = {}) {
    this.spreadBps = params.spreadBps ?? 10;
    this.slippageBps = params.slippageBps ?? 8;
    if (![this.spreadBps,this.slippageBps].every(x=>Number.isFinite(x)&&x>=0)) throw Error('Invalid fill parameters');
  }
  private quote(mid:number, side:'buy'|'sell'):FillQuote {
    const sign = side === 'buy' ? 1 : -1;
    return { price: mid * (1 + sign * (this.spreadBps/2 + this.slippageBps)/10000),
      spreadCost: mid * this.spreadBps / 20000, slippageCost: mid * this.slippageBps / 10000 };
  }
  entry(candle:Candle,side:'buy'|'sell'):FillQuote {return this.quote(candle.open,side);}
  exit(candle:Candle,stop:number|null,target:number|null) {
    // A bar touching both levels must execute the stop; gaps through stops fill at the open.
    if(stop!==null && candle.low<=stop) return {reason:'stop' as const,quote:this.quote(Math.min(stop,candle.open),'sell')};
    if(target!==null && candle.high>=target) return {reason:'target' as const,quote:this.quote(target,'sell')};
    return null;
  }
}
/** Reusable deterministic bid-side replay approximation, not real historic order-book depth. */
export class SyntheticBidModel extends ConservativeOhlcModel {
  override readonly name: FillModelName = 'synthetic-bid';
}
/** Queue position and historic maker fills are unavailable until #2: refuse to simulate them. */
export class MakerQueueModel implements FillModel {
  readonly name: FillModelName = 'maker-queue';
  readonly spreadBps=0; readonly slippageBps=0;
  entry(_candle:Candle,_side:'buy'|'sell'):FillQuote {throw Error('maker-queue awaits issue #2; no queue data');}
  exit(_candle:Candle,_stop:number|null,_target:number|null):{reason:'stop'|'target';quote:FillQuote}|null {
    throw Error('maker-queue awaits issue #2; no queue data');
  }
}
export function makeFillModel(name:FillModelName,params:FillParameters={}):FillModel {
  switch(name) {
    case 'conservative-ohlc':return new ConservativeOhlcModel(params);
    case 'synthetic-bid':return new SyntheticBidModel(params);
    case 'maker-queue':return new MakerQueueModel();
  }
}
