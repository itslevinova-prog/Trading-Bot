import type {ReplayStudy} from './portfolio.js';import {closedRelativeStrength} from '../context/relative-strength.js';
/** Separate research enrichment; does not change active runtime context or its prompt budget. */
export function relativeStrengthReplayStudy(base:ReplayStudy):ReplayStudy{
 return {...base,enrich:(context,markets)=>{const c=base.enrich(context,markets),now=Date.parse(c.timeUTC),mc=c.marketContext as {markets?:Record<string,any>[]} | undefined;
 if(!mc||!Array.isArray(mc.markets))throw Error('Research market context unavailable');return {...c,marketContext:{...mc,markets:mc.markets.map(frame=>{const m=markets.find(m=>m.pair===frame.pair),quote=String(frame.pair).split('/')[1],btc=markets.find(m=>m.pair==='BTC/'+quote);return {...frame,regime:{...frame.regime,relativeStrength4h:closedRelativeStrength(frame.pair,m?.candles??[],btc?.candles??[],now)}};})}};
 }};
}
