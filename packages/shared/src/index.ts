import { z } from 'zod';

export const LevelSchema = z.object({price:z.string(),qty:z.string()});
export type Level = z.infer<typeof LevelSchema>;
export const BookEventSchema = z.object({channel:z.literal('book'),type:z.enum(['snapshot','update']),data:z.array(z.object({symbol:z.string(),bids:z.array(LevelSchema),asks:z.array(LevelSchema),checksum:z.number().int(),timestamp:z.string().optional()}))});
export const TickerEventSchema = z.object({channel:z.literal('ticker'),type:z.enum(['snapshot','update']),data:z.array(z.object({symbol:z.string(),bid:z.number().optional(),ask:z.number().optional(),last:z.number().optional(),volume:z.number().optional(),change_pct:z.number().optional(),timestamp:z.string().optional()}))});
export const OhlcEventSchema = z.object({channel:z.literal('ohlc'),type:z.enum(['snapshot','update']),data:z.array(z.object({symbol:z.string(),interval:z.number(),interval_begin:z.string(),open:z.number(),high:z.number(),low:z.number(),close:z.number(),volume:z.number()}))});
export const FeatureSnapshotSchema = z.object({pair:z.string(),ts:z.number(),ema20:z.number(),ema50:z.number(),ema50_60m:z.number(),prevEma50_60m:z.number().optional(),ema50_60mClosedAt:z.number().optional(),prevEma20:z.number(),prevEma50:z.number(),rsi14:z.number(),atr14:z.number(),atrPct:z.number(),volumeRatio:z.number(),change1h:z.number(),change4h:z.number(),change24h:z.number(),spreadPct:z.number(),distanceEma50Pct:z.number(),price:z.number()});
export type FeatureSnapshot = z.infer<typeof FeatureSnapshotSchema>;
export const ActionSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('buy'),pair:z.string().min(1),amountEur:z.number().positive(),stopLossPct:z.number().min(.02).max(.15),takeProfitPct:z.number().min(.03).max(.40).optional(),confidence:z.number().min(0).max(1),reasoning:z.string().min(1).max(400)}),
 z.object({type:z.literal('sell'),pair:z.string().min(1),sellFraction:z.number().positive().max(1),confidence:z.number().min(0).max(1),reasoning:z.string().min(1).max(400)}),
 z.object({type:z.literal('hold'),pair:z.string().optional(),confidence:z.number().min(0).max(1),reasoning:z.string().min(1).max(400)})
]);
export type Action = z.infer<typeof ActionSchema>;
export const AiAnswerSchema = z.object({marketView:z.string().min(1),actions:z.array(ActionSchema).max(3)}).strict();
export type AiAnswer = z.infer<typeof AiAnswerSchema>;
export function parseAiAnswer(raw:string,activePairs:Set<string>):{marketView:string;actions:Action[];errors:string[];valid:boolean}{
 let parsed:unknown;try{parsed=JSON.parse(raw)}catch{return {marketView:'',actions:[],errors:['Ungültiges JSON'],valid:false}};
 const shell=z.object({marketView:z.string().min(1),actions:z.array(z.unknown()).max(3)}).strict().safeParse(parsed);
 if(!shell.success)return {marketView:'',actions:[],errors:['Ungültige Antwortstruktur'],valid:false};
 const actions:Action[]=[],errors:string[]=[];
 shell.data.actions.forEach((a,i)=>{const r=ActionSchema.safeParse(a);if(!r.success){errors.push(`Aktion ${i+1}: ungültig`);return;} if(r.data.pair&&!activePairs.has(r.data.pair)){errors.push(`Aktion ${i+1}: inaktives Paar`);return;}actions.push(r.data);});
 return {marketView:shell.data.marketView,actions:actions.sort((a,b)=>Number(b.type==='sell')-Number(a.type==='sell')),errors,valid:true};
}
export type Candle={pair:string;interval:number;ts:number;open:number;high:number;low:number;close:number;volume:number};
export type TickerField='bid'|'ask'|'last'|'volume'|'change24h';
export type MarketTicker={symbol:string;bid:number;ask:number;last:number;volume:number;change24h:number;receivedAt:number;fieldReceivedAt?:Record<TickerField,number|null>};
export type OrderBook={symbol:string;bids:Level[];asks:Level[];receivedAt:number;valid:boolean};
export type BrokerOrder={accountId:string;pair:string;side:'buy'|'sell';amountEur?:number;sellFraction?:number;reason:string;decisionId:string;stopLossPct?:number;takeProfitPct?:number;protectiveExit?:boolean;confidence?:number;policyRevision?:number};
export type DecisionContext={timeUTC:string;timeZurich:string;account:unknown;positions:unknown[];features:FeatureSnapshot[];recentTrades:unknown[];limits:Record<string,number>;memory:unknown[];lessons:unknown[];marketContext?:unknown;externalContext?:unknown;execution?:unknown;performance?:unknown;researchEvidence?:unknown;portfolioEvidence?:unknown;forwardEvidence?:unknown;forwardCohort?:unknown;modelIdentity?:unknown;tradingPolicy?:unknown;protectiveExitFailures?:unknown};
export type DecisionResult={marketView:string;actions:Action[];status?:string};
export interface DecisionProvider {decide(context:DecisionContext):Promise<DecisionResult>;getEvidence?():unknown;}
