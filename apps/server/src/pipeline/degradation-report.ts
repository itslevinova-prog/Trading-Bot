import type {StageResult} from './registry.js';
import {readStage} from './registry.js';

export const DEGRADATION_REPORT_VERSION='oos-degradation-v1' as const;
export type StageDescription={
 stage:1|2;
 gateStatus:'passed'|'failed';
 evaluatedAt:string;
 evidenceHash:string|null;
 netReturnPct:number|null;
 btcNetReturnPct:number|null;
 dcaNetReturnPct:number|null;
 btcExcessPctPoints:number|null;
 dcaExcessPctPoints:number|null;
 maxDrawdownPct:number|null;
 costPerTurnoverRate:number|null;
 trades:number|null;
 coveragePct:number|null;
 coverageDays:number|null;
};
export type OosDegradationReport={
 version:typeof DEGRADATION_REPORT_VERSION;
 status:'available'|'insufficient_evidence';
 assessment:'warning'|'descriptive'|'insufficient_evidence';
 strategyId:string;
 strategyVersion:string;
 codeHash:string|null;
 configHash:string|null;
 development:StageDescription|null;
 validation:StageDescription|null;
 delta:{
  netReturnPctPoints:number|null;
  btcExcessPctPoints:number|null;
  dcaExcessPctPoints:number|null;
  maxDrawdownPctPoints:number|null;
  costPerTurnoverRate:number|null;
  trades:number|null;
  coveragePctPoints:number|null;
 }|null;
 reasons:string[];
 note:string;
};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const signed=(v:unknown):number|null=>finite(v)?v:null;
const nonnegative=(v:unknown):number|null=>finite(v)&&v>=0?v:null;
const boundedPercent=(v:unknown):number|null=>finite(v)&&v>=0&&v<=100?v:null;
const count=(v:unknown):number|null=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):null;
const difference=(a:number|null,b:number|null):number|null=>
 a===null||b===null?null:a-b;
const note='Rein deskriptiver, schreibgeschützter Vergleich bereits unveränderlich gespeicherter Stufe-1/2-Ergebnisse. Keine neue Validierung, keine Stufenerhöhung und keine Modellselektion anhand 2024. Fehlende Werte bleiben n/a.';
function explain(result:StageResult,stage:1|2):StageDescription{
 const m=result.metrics;
 const netReturnPct=signed(m.netReturnPct);
 const btcNetReturnPct=signed(m.btcNetReturnPct);
 const dcaNetReturnPct=signed(m.dcaNetReturnPct);
 // Quote amounts MUST share the same denomination. Never divide fees in
 // currency units by a percentage turnover, nor invent unit conversions.
 const explicit=nonnegative(m.costPerTurnoverRate);
 const costs=nonnegative(m.totalCostsQuote),turnover=nonnegative(m.turnoverQuote);
 const costPerTurnoverRate=explicit??(costs!==null&&turnover!==null&&turnover>0?
  costs/turnover:null);
 return {
  stage,gateStatus:result.status,evaluatedAt:result.evaluatedAt,
  evidenceHash:result.evidenceHash,netReturnPct,btcNetReturnPct,dcaNetReturnPct,
  btcExcessPctPoints:difference(netReturnPct,btcNetReturnPct),
  dcaExcessPctPoints:difference(netReturnPct,dcaNetReturnPct),
  maxDrawdownPct:boundedPercent(m.maxDrawdownPct),
  costPerTurnoverRate,
  trades:count(m.trades),
  coveragePct:boundedPercent(m.coveragePct),
  coverageDays:count(m.coverageDays)
 };
}
function base(strategyId:string,strategyVersion:string,reason:string):OosDegradationReport{
 return {version:DEGRADATION_REPORT_VERSION,status:'insufficient_evidence',
  assessment:'insufficient_evidence',strategyId,strategyVersion,
  codeHash:null,configHash:null,development:null,validation:null,delta:null,
  reasons:[reason],note};
}
/**
 * Strictly compares supplied, *completed* stage records. Never accesses market
 * data or calls the evaluation pipeline. A failed Stage 2 remains failed; no
 * positive Stage 1 score can hide the negative observation.
 */
export function compareOosDegradation(
 development:StageResult|null,validation:StageResult|null,
 strategyId:string,version:string
):OosDegradationReport{
 const missing=base(strategyId,version,
  'n/a: genehmigte und abgeschlossene Stage-1/2-Evidenz fehlt');
 if(!development||!validation)return missing;
 if(development.stage!==1||validation.stage!==2||
  development.strategyId!==strategyId||validation.strategyId!==strategyId||
  development.version!==version||validation.version!==version||
  development.codeHash!==validation.codeHash||
  development.configHash!==validation.configHash||
  development.variantsTested!==validation.variantsTested||
  development.status!=='passed'||
  !['passed','failed'].includes(validation.status)||
  !development.source.startsWith('local:')||!validation.source.startsWith('local:')||
  !Number.isFinite(Date.parse(development.evaluatedAt))||
  !Number.isFinite(Date.parse(validation.evaluatedAt))||
  Date.parse(validation.evaluatedAt)<Date.parse(development.evaluatedAt))
  return base(strategyId,version,
   'n/a: Stage-Identität, zeitliche Reihenfolge oder genehmigte Stage 1 widersprüchlich');
 const d=explain(development,1),v=explain(validation,2);
 const delta={
  netReturnPctPoints:difference(v.netReturnPct,d.netReturnPct),
  btcExcessPctPoints:difference(v.btcExcessPctPoints,d.btcExcessPctPoints),
  dcaExcessPctPoints:difference(v.dcaExcessPctPoints,d.dcaExcessPctPoints),
  maxDrawdownPctPoints:difference(v.maxDrawdownPct,d.maxDrawdownPct),
  costPerTurnoverRate:difference(v.costPerTurnoverRate,d.costPerTurnoverRate),
  trades:difference(v.trades,d.trades),
  coveragePctPoints:difference(v.coveragePct,d.coveragePct)
 };
 const warning=validation.status==='failed'||(v.netReturnPct!==null&&v.netReturnPct<0)||
  (delta.netReturnPctPoints!==null&&delta.netReturnPctPoints<0)||
  (delta.btcExcessPctPoints!==null&&delta.btcExcessPctPoints<0)||
  (delta.dcaExcessPctPoints!==null&&delta.dcaExcessPctPoints<0);
 const reasons:string[]=[];
 if(validation.status==='failed')reasons.push('Stage 2 ist gescheitert und bleibt gescheitert');
 if(v.netReturnPct!==null&&v.netReturnPct<0)
  reasons.push('Stage 2 verzeichnet eine negative Netto-Rendite');
 if(delta.netReturnPctPoints!==null&&delta.netReturnPctPoints<0)
  reasons.push('Netto-Rendite fällt gegenüber Stage 1');
 if(v.netReturnPct===null||d.netReturnPct===null)
  reasons.push('Netto-Renditen fehlen teilweise: n/a, kein Profitabilitätsnachweis');
 if(v.btcExcessPctPoints===null||d.btcExcessPctPoints===null)
  reasons.push('Kostenbehafteter BTC-Benchmarkvergleich nicht vollständig belegt');
 if(v.dcaExcessPctPoints===null||d.dcaExcessPctPoints===null)
  reasons.push('Kostenbehafteter DCA-Benchmarkvergleich nicht vollständig belegt');
 return {version:DEGRADATION_REPORT_VERSION,status:'available',
  assessment:warning?'warning':'descriptive',strategyId,strategyVersion:version,
  codeHash:development.codeHash,configHash:development.configHash,
  development:d,validation:v,delta,reasons,note};
}
/** Read only: readStage verifies the immutable registry-anchored hashes.
 * A corrupt stage throws instead of silently returning a reassuring report.
 */
export function readOosDegradation(root:string,strategyId:string,version:string):OosDegradationReport{
 const development=readStage(root,strategyId,version,1);
 if(!development)return base(strategyId,version,'n/a: Stage 1 nicht abgeschlossen');
 // Stage 2 may be absent, including after a failed Stage 1. Never create it.
 const validation=development.status==='passed'?readStage(root,strategyId,version,2):null;
 return compareOosDegradation(development,validation,strategyId,version);
}
