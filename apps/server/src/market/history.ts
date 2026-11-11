import type {Candle} from '@paper/shared';
import {parseKlines} from './binance-data.js';
export type HistoryRange={start:number;end:number};
export function historyPlan(known:number[],interval:15|60,days:number,now:number,tailBars=2,predecessorBars=0){
 if(![15,60].includes(interval)||!Number.isFinite(days)||days<=0||days>365||!Number.isSafeInteger(now)||now<0||!Number.isInteger(tailBars)||tailBars<0||tailBars>10||!Number.isInteger(predecessorBars)||predecessorBars<0||predecessorBars>2)throw Error('Invalid history planning bounds');
 const step=interval*60000,start=Math.max(0,Math.ceil((now-days*86400000)/step)*step-predecessorBars*step),end=Math.floor(now/step)*step-step;
 const times=new Set(known.filter(ts=>Number.isSafeInteger(ts)&&ts>=start&&ts<=end&&ts%step===0));
 const ranges:HistoryRange[]=[];let missing=0;
 for(let ts=start;ts<=end;ts+=step){if(times.has(ts)&&ts<end-(tailBars-1)*step)continue;if(!times.has(ts))missing++;const previous=ranges.at(-1);if(previous&&ts<=previous.end+9*step)previous.end=ts;else ranges.push({start:ts,end:ts});}
 // Scattered holes must not create thousands of tiny public requests.
 if(ranges.length>32)ranges.splice(0,ranges.length,{start:ranges[0]!.start,end:ranges.at(-1)!.end});
 return {start,end,step,expected:Math.max(0,Math.floor((end-start)/step)+1),missing,times,ranges};
}
export type HistoryRepair={pair:string;interval:number;asOf:number;fromTs:number;toTs:number;requests:number;savedBars:number;missingBefore:number;missingAfter:number;stopped:boolean;requestBudgetReached:boolean;complete:boolean};
type RepairOptions={pair:string;interval:15|60;days:number;now:number;known:number[];fetchPage:(start:number,end:number)=>Promise<unknown>;save:(rows:Candle[])=>void;isStopped?:()=>boolean;pause?:()=>Promise<void>;maxRequests?:number;predecessorBars?:number};
/** Public history only. A missing row stays missing; never synthesize an OHLC bar. */
export async function repairHistory(options:RepairOptions):Promise<HistoryRepair>{
 const plan=historyPlan(options.known,options.interval,options.days,options.now,2,options.predecessorBars??0),maxRequests=options.maxRequests??72;
 if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>128)throw Error('Invalid history request budget');
 let requests=0,savedBars=0,stopped=false,requestBudgetReached=false;
 outer:for(const range of plan.ranges){let cursor=range.start;
  while(cursor<=range.end){
   if(options.isStopped?.()){stopped=true;break outer;}if(requests>=maxRequests){requestBudgetReached=true;break outer;}
   if(requests)await options.pause?.();if(options.isStopped?.()){stopped=true;break outer;}
   requests++;const raw=await options.fetchPage(cursor,range.end+plan.step-1);
   if(options.isStopped?.()){stopped=true;break outer;}
   if(!Array.isArray(raw)||raw.length>1000)throw Error('Invalid bounded public history page');if(!raw.length)break;
   const rows=[...new Map(parseKlines(options.pair,options.interval,raw,options.now).filter(row=>row.ts>=cursor&&row.ts<=range.end).map(row=>[row.ts,row])).values()].sort((a,b)=>a.ts-b.ts);
   if(!rows.length)throw Error('Public history page made no valid forward progress');
   options.save(rows);savedBars+=rows.length;for(const row of rows)plan.times.add(row.ts);
   const next=rows.at(-1)!.ts+plan.step;if(next<=cursor)throw Error('Non-progressing public history page');cursor=next;
   if(raw.length<1000)break;
  }
 }
 const missingAfter=Math.max(0,plan.expected-plan.times.size);
 return {pair:options.pair,interval:options.interval,asOf:options.now,fromTs:plan.start,toTs:plan.end,requests,savedBars,missingBefore:plan.missing,missingAfter,stopped,requestBudgetReached,complete:!stopped&&!requestBudgetReached&&missingAfter===0};
}
