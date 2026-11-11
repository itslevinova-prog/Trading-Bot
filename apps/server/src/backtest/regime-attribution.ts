import {createHash} from 'node:crypto';
import type {RegimeProvider,RegimeState} from '../regime/types.js';
import type {RecordedDecision} from './runner.js';
import type {SimulatedTrade} from './simulated-broker.js';
import type {EquityPoint} from './metrics.js';

const FROM=Date.UTC(2020,0,1),TO=Date.UTC(2024,0,1),DAY=86_400_000;
export const REGIME_ATTRIBUTION_VERSION='regime-attribution-v1' as const;
export type RegimeBucket='risk-on'|'neutral'|'risk-off'|'unknown';
export type RegimeAttributionRow={
 regime:RegimeBucket;
 decisions:number;
 tradeFills:number;
 closedTrades:number;
 netRealizedPnl:number;
 fees:number;
 exposedObservations:number;
 observedObservations:number;
 exposureFraction:number|null;
 observedUtcDays:number;
};
export type RegimeAttribution={
 version:typeof REGIME_ATTRIBUTION_VERSION;
 status:'available'|'insufficient_evidence';
 rows:RegimeAttributionRow[];
 unknownRegimeDecisions:number;
 inputHash:string|null;
 note:string;
 reason:string|null;
};
export type RegimeAttributionInput={
 fromMs:number;toMs:number;
 decisions:readonly RecordedDecision[];
 trades:readonly SimulatedTrade[];
 equity:readonly EquityPoint[];
 provider:RegimeProvider;
};
const buckets:readonly RegimeBucket[]=['risk-on','neutral','risk-off','unknown'];
const key=(ts:number,symbol:string)=>ts+':'+symbol;
const utcDay=(ts:number)=>Math.floor(ts/DAY)*DAY;
function isValidTime(ts:number,from:number,to:number):boolean{
 return Number.isSafeInteger(ts)&&ts>=from&&ts<=to&&ts>=FROM&&ts<TO;
}
function verifiedRegime(state:RegimeState,ts:number):RegimeBucket{
 if(!state||!Number.isSafeInteger(state.asOf)||state.asOf>ts||
  !Number.isFinite(state.score)||state.score<0||state.score>1||
  !['risk-on','risk-off','neutral'].includes(state.regime)||
  !Array.isArray(state.reasons)||state.reasons.some(reason=>
   typeof reason!=='string'||reason.startsWith('Daten unvollständig')))
  return 'unknown';
 return state.regime;
}
/** Read-only descriptive breakdown: NEVER selects a strategy or accesses validation/holdout.
 * A closed trade's net realized PnL is attributed to the ENTRY decision's
 * historical regime, not the future exit regime; fees are NOT deducted twice.
 * Exposure is counted only at observed equity timestamps, with no interpolation.
 */
export async function analyzeRegimeAttribution(input:RegimeAttributionInput):Promise<RegimeAttribution>{
 const {fromMs,toMs,decisions,trades,equity,provider}=input;
 const empty=(reason:string):RegimeAttribution=>({
  version:REGIME_ATTRIBUTION_VERSION,status:'insufficient_evidence',
  rows:[],unknownRegimeDecisions:0,inputHash:null,
  note:'Rein beschreibende Attribution; keine Ex-post-Regimeoptimierung, keine interpolierte Exposure.',
  reason
 });
 if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||
  fromMs<FROM||toMs>TO||fromMs>=toMs)
  return empty('n/a: nur Entwicklungsdaten 2020–2023 zulässig');
 if(!Array.isArray(decisions)||!Array.isArray(trades)||!Array.isArray(equity)||
  equity.length<1||!provider||typeof provider.getRegime!=='function')
  return empty('n/a: unvollständige Entscheidungen, Fills, Equity oder Regimequelle');
 const known=new Set<string>();
 for(const d of decisions){
  if(!isValidTime(d.ts,fromMs,toMs)||typeof d.symbol!=='string'||!d.symbol||
   !Array.isArray(d.actions))
   return empty('n/a: ungültiger Entscheidungsbeleg');
  if(known.has(key(d.ts,d.symbol)))return empty('n/a: doppelte Entscheidungszeit pro Markt');
  known.add(key(d.ts,d.symbol));
 }
 for(const t of trades)if(!isValidTime(t.ts,fromMs,toMs)||
   !isValidTime(t.decisionTs,fromMs,toMs)||t.decisionTs>t.ts||
   !t.symbol||!['buy','sell'].includes(t.side)||!Number.isFinite(t.qty)||t.qty<=0||
   !Number.isFinite(t.fee)||t.fee<0||
   (t.side==='sell'&&!Number.isFinite(t.realizedPnl))||
   (t.side==='buy'&&t.realizedPnl!==null))
  return empty('n/a: ungültige oder zukünftige Fill-/Entscheidungszeit');
 for(const p of equity)if(!isValidTime(p.ts,fromMs,toMs)||
   !Number.isFinite(p.equity)||p.equity<=0||typeof p.exposed!=='boolean')
  return empty('n/a: ungültige oder ausserhalb des Entwicklungsfensters liegende Equity');
 const rows=new Map<RegimeBucket,RegimeAttributionRow>();
 const days=new Map<RegimeBucket,Set<number>>();
 for(const regime of buckets){
  rows.set(regime,{regime,decisions:0,tradeFills:0,closedTrades:0,
   netRealizedPnl:0,fees:0,exposedObservations:0,observedObservations:0,
   exposureFraction:null,observedUtcDays:0});
  days.set(regime,new Set());
 }
 const observations=new Map<number,Promise<RegimeBucket>>();
 const at=(ts:number):Promise<RegimeBucket>=>{
  let answer=observations.get(ts);
  if(!answer){
   answer=Promise.resolve().then(()=>provider.getRegime(ts))
    .then(state=>verifiedRegime(state,ts)).catch(()=>'unknown' as const);
   observations.set(ts,answer);
  }
  return answer;
 };
 const decisionTags=new Map<string,RegimeBucket>();
 for(const d of decisions){
  const regime=await at(d.ts);
  decisionTags.set(key(d.ts,d.symbol),regime);
  rows.get(regime)!.decisions++;
  days.get(regime)!.add(utcDay(d.ts));
 }
 // The simulated broker permits one open lot per symbol; partial exits retain
 // that entry regime. Missing preceding buys remain UNKNOWN, never guessed.
 const positions=new Map<string,{regime:RegimeBucket;qty:number}>();
 const sorted=trades.map((trade,index)=>({trade,index}))
  .sort((a,b)=>a.trade.ts-b.trade.ts||a.index-b.index);
 for(const {trade:t} of sorted){
  const current=positions.get(t.symbol);
  if(t.side==='buy'){
   if(current&&current.qty>1e-8)return empty('n/a: überlappende Einstandslots ohne FIFO-Beleg');
   const regime=decisionTags.get(key(t.decisionTs,t.symbol))??'unknown';
   positions.set(t.symbol,{regime,qty:t.qty});
   const row=rows.get(regime)!;row.tradeFills++;row.fees+=t.fee;
  }else{
   if(current&&t.qty>current.qty+1e-8)
    return empty('n/a: Verkauf übersteigt den belegten Positionsbestand');
   const regime=current?.regime??'unknown';
   const row=rows.get(regime)!;
   row.tradeFills++;row.closedTrades++;row.fees+=t.fee;
   row.netRealizedPnl+=t.realizedPnl!;
   if(current){
    const remaining=current.qty-t.qty;
    if(remaining<=1e-8)positions.delete(t.symbol);
    else current.qty=remaining;
   }
  }
 }
 for(const p of equity){
  const regime=await at(p.ts);
  const row=rows.get(regime)!;
  row.observedObservations++;
  if(p.exposed)row.exposedObservations++;
  days.get(regime)!.add(utcDay(p.ts));
 }
 const result=[...buckets].map(regime=>{
  const row=rows.get(regime)!;
  row.observedUtcDays=days.get(regime)!.size;
  row.exposureFraction=row.observedObservations?
   row.exposedObservations/row.observedObservations:null;
  return row;
 });
 if(result.some(r=>!Number.isFinite(r.netRealizedPnl)||!Number.isFinite(r.fees)))
  return empty('n/a: nicht-finite historische Netto-PnL-/Gebühren-Belege');
 const inputHash=createHash('sha256').update(JSON.stringify({
  version:REGIME_ATTRIBUTION_VERSION,fromMs,toMs,decisions,trades,equity,
  regimes:await Promise.all([...observations.keys()].sort((a,b)=>a-b)
   .map(async ts=>({ts,regime:await at(ts)})))
 })).digest('hex');
 return {
  version:REGIME_ATTRIBUTION_VERSION,status:'available',rows:result,
  unknownRegimeDecisions:rows.get('unknown')!.decisions,inputHash,
  note:'Netto-PnL aus geschlossenen Broker-Trades (inklusive Eintritts-/Austrittsgebühren) zum Entry-Regime; Gebühren nur separat ausgewiesen. Exposure = beobachtete Equity-Punkte, keine interpolierten Tage. Unvollständige Regime bleiben unknown.',
  reason:rows.get('unknown')!.decisions?'Nicht alle Entscheidungen hatten verifizierbare Point-in-Time-Regime':'Keine fehlenden Entscheidungsregime'
 };
}
