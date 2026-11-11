import {createHash} from 'node:crypto';
import {quantile} from './stats.js';

const FROM=Date.UTC(2020,0,1),TO=Date.UTC(2024,0,1);
const MIN_CLUSTERS=10; // a precommitted diagnostic sufficiency threshold, not a gate.
export const EVIDENCE_DENSITY_VERSION='trade-cluster-evidence-v1' as const;
export type EvidenceTrade={
 id:string;pair:string;
 /** Time when the decision became available, not when the order was filled. */
 decisionAtMs:number|null;
 openedAtMs:number|null;
 /** A still-open or missing exit interval cannot establish independent outcomes. */
 closedAtMs:number|null;
 regimeAtDecision:string|null;
 /** Optional realized net PnL in a consistent quote unit for cluster-resampled diagnostics. */
 realizedNetPnl?:number|null;
};
export type EvidenceCluster={
 id:string;firstDecisionAtMs:number;lastClosedAtMs:number;
 tradeIds:string[];symbols:string[];decisionDays:string[];
 regime:'unknown'|'mixed'|string;
 realizedNetPnl:number|null;
};
export type EvidenceDensity={
 version:typeof EVIDENCE_DENSITY_VERSION;
 status:'available'|'unavailable';
 totalTrades:number;decisionDays:number|null;
 eventClusters:number|null;maxTradesPerCluster:number|null;
 regimeCounts:Record<string,{trades:number;clusters:number}>;
 clusters:EvidenceCluster[];
 /** Only a cluster-resampled net-PnL *diagnostic*, never an effective exact sample size. */
 confidenceStatus:'diagnostic_only'|'unavailable';
 confidenceBand:{p10:number;p50:number;p90:number}|null;
 minimumClustersForConfidence:10;
 dataFingerprint:string|null;
 reason:string|null;
};
function sha(x:unknown){return createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function rng(seed:number){
 let s=(seed>>>0)||0x9e3779b9;
 return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}
const day=(ms:number)=>new Date(ms).toISOString().slice(0,10);
function valid(t:EvidenceTrade):boolean{
 return typeof t.id==='string'&&/^[a-zA-Z0-9_.:-]{1,120}$/.test(t.id)&&
  typeof t.pair==='string'&&t.pair.length>0&&
  Number.isSafeInteger(t.decisionAtMs)&&Number.isSafeInteger(t.openedAtMs)&&
  Number.isSafeInteger(t.closedAtMs)&&
  t.decisionAtMs!>=FROM&&t.decisionAtMs!<=t.openedAtMs!&&
  t.openedAtMs!<=t.closedAtMs!&&t.closedAtMs!<TO&&
  (t.regimeAtDecision===null||
   (typeof t.regimeAtDecision==='string'&&/^[a-zA-Z0-9_-]{1,48}$/.test(t.regimeAtDecision)))&&
  (t.realizedNetPnl===undefined||t.realizedNetPnl===null||Number.isFinite(t.realizedNetPnl));
}
/**
 * Interval-connected holdings and identical decision instants are dependent
 * clusters regardless of how many symbols traded. UTC days and decision-time
 * regimes are reported but NEVER represented as exact statistical degrees.
 */
export function diagnoseTradeEvidence(
 trades:readonly EvidenceTrade[],
 options:{seed?:number;paths?:number}={}
):EvidenceDensity{
 const seed=options.seed??1,paths=options.paths??1000;
 if(!Number.isSafeInteger(seed)||!Number.isSafeInteger(paths)||paths<100||paths>10000)
  throw Error('Invalid precommitted cluster-bootstrap settings');
 const empty=(reason:string):EvidenceDensity=>({
  version:EVIDENCE_DENSITY_VERSION,status:'unavailable',totalTrades:trades.length,
  decisionDays:null,eventClusters:null,maxTradesPerCluster:null,regimeCounts:{},
  clusters:[],confidenceStatus:'unavailable',confidenceBand:null,
  minimumClustersForConfidence:10,dataFingerprint:null,reason
 });
 if(!Array.isArray(trades)||!trades.length)return empty('n/a: Keine abgeschlossenen Trade-Outcomes');
 const ids=new Set<string>();
 for(const trade of trades){
  if(!valid(trade)||ids.has(trade.id))
   return empty('n/a: Fehlende, widersprüchliche oder nicht-entwicklungszeitliche Trade-Metadaten');
  ids.add(trade.id);
 }
 const parent=trades.map((_,i)=>i);
 const find=(x:number):number=>{
  while(parent[x]!==x){parent[x]=parent[parent[x]!]!;x=parent[x]!;}
  return x;
 };
 const merge=(a:number,b:number)=>{
  const rootA=find(a),rootB=find(b);
  if(rootA!==rootB)parent[Math.max(rootA,rootB)]=Math.min(rootA,rootB);
 };
 // Sweep-line union of all overlapping holding intervals (including across coins).
 const sorted=trades.map((t,i)=>({t,i}))
  .sort((a,b)=>a.t.openedAtMs!-b.t.openedAtMs!||
   a.t.closedAtMs!-b.t.closedAtMs!||a.t.id.localeCompare(b.t.id));
 let activePivot=-1,maxEnd=-1;
 for(const {t,i} of sorted){
  if(activePivot>=0&&t.openedAtMs!<=maxEnd)merge(i,activePivot);
  else activePivot=i;
  maxEnd=activePivot===i?t.closedAtMs!:Math.max(maxEnd,t.closedAtMs!);
 }
 const decisions=new Map<number,number>();
 for(let i=0;i<trades.length;i++){
  const first=decisions.get(trades[i]!.decisionAtMs!);
  if(first!==undefined)merge(i,first);
  else decisions.set(trades[i]!.decisionAtMs!,i);
 }
 const grouped=new Map<number,EvidenceTrade[]>();
 for(let i=0;i<trades.length;i++){
  const root=find(i),group=grouped.get(root)??[];
  group.push(trades[i]!);grouped.set(root,group);
 }
 const clusters=[...grouped.values()].map(group=>{
  const ids=group.map(t=>t.id).sort();
  const symbols=[...new Set(group.map(t=>t.pair))].sort();
  const regimes=[...new Set(group.map(t=>t.regimeAtDecision??'unknown'))];
  const regime=regimes.length===1?regimes[0]!:'mixed';
  const firstDecisionAtMs=Math.min(...group.map(t=>t.decisionAtMs!));
  const lastClosedAtMs=Math.max(...group.map(t=>t.closedAtMs!));
  const decisionDays=[...new Set(group.map(t=>day(t.decisionAtMs!)))].sort();
  const withPnl=group.every(t=>t.realizedNetPnl!==undefined&&t.realizedNetPnl!==null);
  return {id:sha({ids,firstDecisionAtMs,lastClosedAtMs}),
   firstDecisionAtMs,lastClosedAtMs,tradeIds:ids,symbols,decisionDays,regime,
   realizedNetPnl:withPnl?group.reduce((sum,t)=>sum+t.realizedNetPnl!,0):null};
 }).sort((a,b)=>a.firstDecisionAtMs-b.firstDecisionAtMs||a.id.localeCompare(b.id));
 const regimeCounts:Record<string,{trades:number;clusters:number}>={};
 for(const cluster of clusters){
  const row=regimeCounts[cluster.regime]??{trades:0,clusters:0};
  row.trades+=cluster.tradeIds.length;row.clusters++;
  regimeCounts[cluster.regime]=row;
 }
 const decisionDays=new Set(trades.map(t=>day(t.decisionAtMs!))).size;
 const confidenceReady=clusters.length>=MIN_CLUSTERS &&
  clusters.every(cluster=>cluster.realizedNetPnl!==null);
 let confidenceBand:EvidenceDensity['confidenceBand']=null;
 if(confidenceReady){
  const draw=rng(seed),results:number[]=[];
  for(let p=0;p<paths;p++){
   let sum=0;
   for(let i=0;i<clusters.length;i++)
    sum+=clusters[Math.floor(draw()*clusters.length)]!.realizedNetPnl!;
   results.push(sum);
  }
  confidenceBand={p10:quantile(results,.10),p50:quantile(results,.50),p90:quantile(results,.90)};
 }
 return {version:EVIDENCE_DENSITY_VERSION,status:'available',
  totalTrades:trades.length,decisionDays,eventClusters:clusters.length,
  maxTradesPerCluster:Math.max(...clusters.map(c=>c.tradeIds.length)),
  regimeCounts,clusters,confidenceStatus:confidenceReady?'diagnostic_only':'unavailable',
  confidenceBand,minimumClustersForConfidence:10,
  dataFingerprint:sha({version:EVIDENCE_DENSITY_VERSION,clusters,seed,paths}),
  reason:confidenceReady?
   'Cluster-bootstrap ist nur deskriptiv, keine genaue Zahl unabhängiger Freiheitsgrade oder Stage-Freigabe':
   'n/a: Zu wenige Cluster oder unvollständige Netto-Trade-Outcomes; keine Konfidenzschätzung'
 };
}
