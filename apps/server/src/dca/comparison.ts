import type {DcaResult,DcaVariant} from './simulator.js';

export const DCA_VARIANTS = ['classic','trend-park','trend-double','value-average'] as const satisfies readonly DcaVariant[];
type Range = {min:number;median:number;max:number};
export type PairedDcaComparison = {
 fromMs:number;toMs:number;variant:Exclude<DcaVariant,'classic'>;
 deltaTwr:number;deltaIrr:number|null;deltaNetWorth:number;
};
export type DcaVariantDistribution = {
 variant:DcaVariant;runs:number;twr:Range;irr:Range|null;missingIrr:number;
 deltaTwrVersusClassic:Range|null;deltaIrrVersusClassic:Range|null;
};
export type DcaComparisonSummary = {
 kind:'paired-development-only';starts:number;distributions:DcaVariantDistribution[];
 pairs:PairedDcaComparison[];
 warning:string;
};
function range(values:number[]):Range|null{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);
 return {min:sorted[0]!,median:sorted.length%2?sorted[mid]!:(sorted[mid-1]!+sorted[mid]!)/2,max:sorted.at(-1)!};
}
function valid(run:DcaResult) {
 if(!Number.isSafeInteger(run.fromMs)||!Number.isSafeInteger(run.toMs)||run.fromMs>=run.toMs||
  !Number.isFinite(run.contributed)||run.contributed<0||
  !Number.isFinite(run.netWorth)||run.netWorth<0||!Number.isFinite(run.twr)||
  run.irr!==null&&!Number.isFinite(run.irr)||
  !DCA_VARIANTS.includes(run.variant))throw Error('Invalid DCA development report');
}
function sameInputs(a:DcaResult,b:DcaResult) {
 return a.fromMs===b.fromMs&&a.toMs===b.toMs&&
  a.contributed===b.contributed&&
  a.deposits.length===b.deposits.length&&
  a.deposits.every((d,i)=>d.ts===b.deposits[i]?.ts&&d.amount===b.deposits[i]?.amount)&&
  a.constraints.feeRate===b.constraints.feeRate&&
  a.constraints.spreadBps===b.constraints.spreadBps&&
  a.constraints.slippageBps===b.constraints.slippageBps&&
  a.constraints.minNotional===b.constraints.minNotional;
}
/** Strict paired summaries; rejects missing variants or unequal funding/costs instead of ranking incomparable runs. */
export function summarizeDcaRuns(runs:readonly DcaResult[]):DcaComparisonSummary {
 if(!runs.length)throw Error('No DCA development runs to compare');
 const groups=new Map<string,Map<DcaVariant,DcaResult>>();
 for(const run of runs){
  valid(run);
  const id=run.fromMs+':'+run.toMs,group=groups.get(id)??new Map<DcaVariant,DcaResult>();
  if(group.has(run.variant))throw Error('Duplicate DCA variant for the same start date');
  group.set(run.variant,run);groups.set(id,group);
 }
 const pairs:PairedDcaComparison[]=[];
 const deltas=new Map<DcaVariant,{twr:number[];irr:number[]}>();
 for(const group of groups.values()){
  const classic=group.get('classic');
  if(!classic)throw Error('DCA comparison requires classic baseline');
  if(group.size!==DCA_VARIANTS.length)throw Error('DCA comparison requires all four predeclared variants for every start date');
  for(const variant of DCA_VARIANTS){
   const candidate=group.get(variant);
   if(!candidate||!sameInputs(classic,candidate))throw Error('DCA comparison requires identical deposits, costs and evaluation windows');
   if(variant==='classic')continue;
   const deltaTwr=candidate.twr-classic.twr,deltaIrr=candidate.irr===null||classic.irr===null?null:candidate.irr-classic.irr;
   pairs.push({fromMs:candidate.fromMs,toMs:candidate.toMs,variant,deltaTwr,deltaIrr,
    deltaNetWorth:candidate.netWorth-classic.netWorth});
   const list=deltas.get(variant)??{twr:[],irr:[]};
   list.twr.push(deltaTwr);if(deltaIrr!==null)list.irr.push(deltaIrr);deltas.set(variant,list);
  }
 }
 const distributions:DcaVariantDistribution[]=DCA_VARIANTS.map(variant=>{
  const observations=[...groups.values()].map(g=>g.get(variant)!);
  const twr=range(observations.map(r=>r.twr))!;
  const irr=range(observations.flatMap(r=>r.irr===null?[]:[r.irr]));
  const diff=deltas.get(variant);
  return {variant,runs:observations.length,twr,irr,missingIrr:observations.length-(irr===null?0:observations.filter(r=>r.irr!==null).length),
   deltaTwrVersusClassic:diff?range(diff.twr):null,
   deltaIrrVersusClassic:diff?range(diff.irr):null};
 });
 return {kind:'paired-development-only',starts:groups.size,distributions,
  pairs:pairs.sort((a,b)=>a.fromMs-b.fromMs||DCA_VARIANTS.indexOf(a.variant)-DCA_VARIANTS.indexOf(b.variant)),
  warning:'Nur simulierte Entwicklungsdaten 2020–2023 mit identischen Einzahlungen und Kostenannahmen. Keine unabhängige Prüfung, keine Aussage zur Profitabilität und kein Vergleich mit einer aktiven Strategie.'};
}
