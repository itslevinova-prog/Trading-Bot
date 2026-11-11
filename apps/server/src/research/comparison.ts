type Report={generatedAt?:unknown;strategyVersion?:unknown;dataHash?:unknown;universeHash?:unknown;fixedDataset?:{datasetId?:unknown;optionsHash?:unknown}|null;base?:{returnPct?:unknown;closedTrades?:unknown;missingValuationBars?:unknown;unliquidatedPositions?:unknown};stress?:{returnPct?:unknown}};
const numeric=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const fingerprint=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** Pairing is descriptive: repeated historical inspection does not create new evidence. */
export function compareResearchReports(current:Report,previous:unknown){
 const warning='Same-input historical comparisons are descriptive only; already-inspected samples do not establish independent profitability.';
 if(!previous||typeof previous!=='object'||Array.isArray(previous))return {available:false,inputsComparable:false,reason:'No previous local report',warning};
 const prior=previous as Report;
 if(typeof prior.generatedAt!=='string'||!Number.isFinite(Date.parse(prior.generatedAt))||Date.parse(prior.generatedAt)>Date.now()+60000||!numeric(prior.base?.returnPct)||!numeric(prior.base?.closedTrades)||prior.base!.closedTrades!<0||!Number.isInteger(prior.base!.closedTrades))return {available:false,inputsComparable:false,reason:'Previous report lacks valid dated metrics',warning};
 const changes:string[]=[];
 if(!fingerprint(current.fixedDataset?.datasetId)||!fingerprint(prior.fixedDataset?.datasetId))changes.push('Dataset was not frozen in both reports');
 if(!fingerprint(current.dataHash)||current.dataHash!==prior.dataHash)changes.push('Price rows or market order changed');
 if(!fingerprint(current.universeHash)||current.universeHash!==prior.universeHash)changes.push('Market membership or executable filters changed');
 if(!fingerprint(current.fixedDataset?.optionsHash)||current.fixedDataset!.optionsHash!==prior.fixedDataset?.optionsHash)changes.push('Costs, risk settings or evaluation window changed');
 const inputsComparable=changes.length===0;
 const complete = (metrics: Report['base']) =>
  metrics?.missingValuationBars === 0 && metrics.unliquidatedPositions === 0;
 const outcomesComparable=inputsComparable&&complete(current.base)&&complete(prior.base)&&numeric(current.base?.returnPct);
 const outcomeComparisonReason=inputsComparable&&!outcomesComparable
  ?'Both reports require complete portfolio valuations and no residual positions'
  :null;
 return {available:true,inputsComparable,outcomesComparable,outcomeComparisonReason,changes,previousGeneratedAt:prior.generatedAt,previousReturnPct:prior.base!.returnPct,previousClosedTrades:prior.base!.closedTrades,previousStressReturnPct:numeric(prior.stress?.returnPct)?prior.stress.returnPct:null,sameDataset:current.fixedDataset?.datasetId===prior.fixedDataset?.datasetId,sameStrategyVersion:typeof current.strategyVersion==='string'&&current.strategyVersion===prior.strategyVersion,returnDifferencePercentagePoints:outcomesComparable&&numeric(current.base?.returnPct)?current.base.returnPct-prior.base!.returnPct!:null,warning};
}
