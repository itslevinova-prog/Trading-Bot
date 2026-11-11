import {runBacktest,type BacktestOptions,type BacktestResult} from './runner.js';
export type StressCase='double-fees'|'double-slippage'|'one-bar-delay'|'drop-5-percent-signals';
export type StressResult={name:StressCase;netReturn:number;trades:number;rejectedOrders:number};
export type Robustness='robust'|'questionable'|'fragile'|'insufficient_evidence';
/** Exact reruns of the production-provider runner, never a post-hoc PnL haircut. */
export async function runStressTests(options:BacktestOptions):Promise<StressResult[]> {
  const scenarios:Array<{name:StressCase;patch:Partial<BacktestOptions>}>= [
    {name:'double-fees',patch:{feeRate:(options.feeRate??.001)*2}},
    {name:'double-slippage',patch:{slippageBps:(options.slippageBps??8)*2}},
    {name:'one-bar-delay',patch:{executionDelayBars:1}},
    {name:'drop-5-percent-signals',patch:{dropSignalPct:.05}}
  ];
  const results:StressResult[]=[];
  for(const scenario of scenarios) {
    const r=await runBacktest({...options,...scenario.patch});
    results.push({name:scenario.name,netReturn:r.metrics.netReturn,trades:r.trades.length,rejectedOrders:r.rejections.length});
  }
  return results;
}
export function robustnessLight(base:BacktestResult,stress:readonly StressResult[],costMatrix?:CostStressMatrix):Robustness {
  if(costMatrix && (costMatrix.status!=='complete'||costMatrix.cells.length!==5||
    costMatrix.cells.some(cell=>cell.status!=='available'||cell.inputHash!==costMatrix.inputHash||
      cell.netReturn===null||!Number.isFinite(cell.netReturn))))
    return 'insufficient_evidence';
  const m=base.metrics;
  if(m.pbo===null||!Number.isFinite(m.pbo)||m.pbo<0||m.pbo>1||
     m.deflatedSharpeProbability===null||!Number.isFinite(m.deflatedSharpeProbability)||
     m.deflatedSharpeProbability<0||m.deflatedSharpeProbability>1)return 'insufficient_evidence';
  if(m.netReturn<=0||m.pbo>=.5)return 'fragile';
  if(stress.length!==4||stress.some(x=>!Number.isFinite(x.netReturn)||x.netReturn<=0)||
     (costMatrix&&costMatrix.cells.some(x=>x.netReturn!<=0))||m.deflatedSharpeProbability<.95||m.pbo>=.2)return 'questionable';
  return 'robust';
}

/** A fixed, versioned 5-cell stress matrix; every cell reruns the complete broker and provider. */
export const COST_STRESS_MATRIX_VERSION='cost-stress-matrix-v1' as const;
export type CostStressCase='baseline'|'fees-x2'|'spread-x2'|'slippage-x2'|'combined-x2';
export type CostStressCell={
 name:CostStressCase;
 status:'available'|'unavailable';
 /** Exact pricing assumptions sent to runBacktest, never after-the-fact haircuts. */
 assumptions:{feeRate:number;spreadBps:number;slippageBps:number};
 netReturn:number|null;
 fills:number|null;
 rejectedOrders:number|null;
 costs:{fees:number;spread:number;slippage:number;total:number}|null;
 inputHash:string|null;
 configurationHash:string|null;
 reason:string|null;
};
export type CostStressMatrix={
 version:typeof COST_STRESS_MATRIX_VERSION;
 status:'complete'|'insufficient_evidence';
 inputHash:string|null;
 cells:CostStressCell[];
};

/**
 * Offline-only paired broker replays; no 2024 validation or 2025+ holdout access.
 * Missing cells, unavailable maker fills and mismatched input hashes fail closed.
 */
export async function runCostStressMatrix(options:BacktestOptions):Promise<CostStressMatrix> {
 const feeRate=options.feeRate??.001,spreadBps=options.spreadBps??10,slippageBps=options.slippageBps??8;
 const cases:readonly {name:CostStressCase;assumptions:{feeRate:number;spreadBps:number;slippageBps:number}}[]=[
  {name:'baseline',assumptions:{feeRate,spreadBps,slippageBps}},
  {name:'fees-x2',assumptions:{feeRate:feeRate*2,spreadBps,slippageBps}},
  {name:'spread-x2',assumptions:{feeRate,spreadBps:spreadBps*2,slippageBps}},
  {name:'slippage-x2',assumptions:{feeRate,spreadBps,slippageBps:slippageBps*2}},
  {name:'combined-x2',assumptions:{feeRate:feeRate*2,spreadBps:spreadBps*2,slippageBps:slippageBps*2}}
 ];
 const missing=(reason:string,name:CostStressCase,assumptions:(typeof cases)[number]['assumptions']):CostStressCell=>({
  name,status:'unavailable',assumptions,netReturn:null,fills:null,rejectedOrders:null,
  costs:null,inputHash:null,configurationHash:null,reason
 });
 const blocked=(reason:string):CostStressMatrix=>({version:COST_STRESS_MATRIX_VERSION,status:'insufficient_evidence',inputHash:null,
  cells:cases.map(x=>missing(reason,x.name,x.assumptions))});
 // Check the sealed development window before reading a single candle or symbol.
 if(!Number.isSafeInteger(options.fromMs)||!Number.isSafeInteger(options.toMs)||
    options.fromMs<Date.UTC(2020,0,1)||options.toMs>Date.UTC(2024,0,1)||
    options.toMs<=options.fromMs)
  return blocked('n/a: Kostenmatrix nur auf Entwicklungsdaten 2020–2023 zulässig');
 if(![feeRate,spreadBps,slippageBps].every(x=>Number.isFinite(x)&&x>=0))
  return blocked('n/a: Unzulässige Kostenannahmen');
 if(options.fillModel==='maker-queue')
  return blocked('n/a: Historische Maker-Queue-Fills sind nicht belegt');
 let inputHash:string|null=null;
 const cells:CostStressCell[]=[];
 for(const scenario of cases){
  try{
   const result=await runBacktest({...options,...scenario.assumptions});
   if(!Number.isFinite(result.metrics.netReturn))throw Error('Non-finite net return');
   if(scenario.name==='baseline')inputHash=result.fingerprints.data;
   if(!inputHash||result.fingerprints.data!==inputHash)
    throw Error('Input fingerprint differs from the paired baseline replay');
   const fees=result.trades.reduce((sum,t)=>sum+t.fee,0);
   const spread=result.trades.reduce((sum,t)=>sum+t.spreadCost,0);
   const slippage=result.trades.reduce((sum,t)=>sum+t.slippageCost,0);
   if(![fees,spread,slippage].every(x=>Number.isFinite(x)&&x>=0))
    throw Error('Invalid broker-booked fill cost');
   cells.push({name:scenario.name,status:'available',assumptions:scenario.assumptions,
    netReturn:result.metrics.netReturn,fills:result.trades.length,rejectedOrders:result.rejections.length,
    costs:{fees,spread,slippage,total:fees+spread+slippage},
    inputHash:result.fingerprints.data,configurationHash:result.fingerprints.configuration,reason:null});
  }catch(error){
   cells.push(missing('n/a: Vollständiger Broker-Replay fehlgeschlagen: '+(error instanceof Error?error.message:String(error)),
    scenario.name,scenario.assumptions));
  }
 }
 return {version:COST_STRESS_MATRIX_VERSION,
  status:inputHash!==null&&cells.length===cases.length&&cells.every(cell=>cell.status==='available')?
   'complete':'insufficient_evidence',inputHash,cells};
}
