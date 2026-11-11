import type {Candle} from '@paper/shared';
import type {PortfolioFill} from './portfolio.js';
export const POLICY_FAILURE_VERSION='policy-failure-diagnostics-v1';
export function policyExitCause(fill:PortfolioFill|null){
 if(!fill)return 'still-open';if(fill.side!=='sell')throw Error('Sell receipt required for exit attribution');
 if(fill.reason==='evaluation end liquidation')return 'evaluation-end-censored';
 if(fill.reason==='gap stop'||fill.reason==='intrabar stop-first')return 'protective-stop';
 if(fill.reason==='intrabar target'||fill.reason.startsWith('gap target'))return 'protective-target';
 if(fill.reason==='latched protective retry')return 'latched-protective-retry';
 if(fill.reason.startsWith('STRUCTURE-EXIT:'))return 'rolling-structure-exit';
 if(fill.reason.startsWith('ENTRY-SUPPORT:'))return 'original-support-exit';
 return fill.protective?'other-protective':'other-strategy-exit';
}
/** POST-OUTCOME diagnostic only. Entry/exit candles are excluded: their extrema/close
 * may precede entry or follow exit. Interior closes are hypothetical net marks, NOT
 * achievable fills, alternative exit returns, or decision-time learning features. */
export function interiorCloseMarks(entry:PortfolioFill,exitBarTs:number|null,candles:Candle[],costs:{feeRate:number;spreadBps:number;slippageBps:number}){
 const validTime=(v:number)=>Number.isSafeInteger(v)&&v>=0&&v%900000===0;
 if(entry.side!=='buy'||!validTime(entry.barTs)||![entry.qty,entry.price,entry.fee,costs.feeRate,costs.spreadBps,costs.slippageBps].every(Number.isFinite)||entry.qty<=0||entry.price<=0||entry.fee<0||costs.feeRate<0||costs.feeRate>.05||costs.spreadBps<0||costs.spreadBps>1000||costs.slippageBps<0||costs.slippageBps>1000||exitBarTs!==null&&(!validTime(exitBarTs)||exitBarTs<entry.barTs))throw Error('Invalid diagnostic ledger/cost clock');
 const base={version:POLICY_FAILURE_VERSION,scope:'post-outcome-interior-close-marks-not-executable-fills',entryAndExitBarsExcluded:true,complete:false,observedBars:0,expectedBars:exitBarTs===null?null:Math.max(0,(exitBarTs-entry.barTs)/900000-1),maximumNetMarkPct:null as number|null,minimumNetMarkPct:null as number|null,firstPositiveCloseTs:null as number|null};
 if(exitBarTs===null)return base;
 const rows=candles.filter(c=>c.pair===entry.pair&&c.interval===15&&c.ts>entry.barTs&&c.ts<exitBarTs).sort((a,b)=>a.ts-b.ts);
 const complete=rows.length===base.expectedBars&&rows.every((c,i)=>c.ts===entry.barTs+(i+1)*900000&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&c.low>0&&c.volume>=0&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
 if(!complete)return {...base,observedBars:rows.length};
 const basis=entry.qty*entry.price+entry.fee,multiplier=(1-costs.spreadBps/20000)*(1-costs.slippageBps/10000)*(1-costs.feeRate),marks=rows.map(c=>(entry.qty*c.close*multiplier/basis-1)*100);
 if(!Number.isFinite(basis)||basis<=0||marks.some(v=>!Number.isFinite(v)))throw Error('Unbounded post-outcome mark');
 return {...base,complete:true,observedBars:rows.length,maximumNetMarkPct:marks.length?Math.max(...marks):null,minimumNetMarkPct:marks.length?Math.min(...marks):null,firstPositiveCloseTs:rows.find((_,i)=>marks[i]!>0)?.ts??null};
}
