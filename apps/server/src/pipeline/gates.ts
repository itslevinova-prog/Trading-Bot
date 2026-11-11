import type {Stage,StageCheck,PipelineVersion} from './registry.js';

export type Evidence = {
 stage:Stage;strategyId:string;version:string;codeHash:string;configHash:string;
 periodFrom:string;periodToExclusive:string;dataHashes:Record<string,string>;
 metrics:Record<string,unknown>;source:string;
};
export type GateContext = {stage:Stage;entry:PipelineVersion;hypothesisVerified:boolean;previous:Record<string,unknown>|null;previousStage3:Record<string,unknown>|null;holdoutGuardVerified:boolean};
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const gt=(x:unknown,y:unknown)=>finite(x)&&finite(y)&&x>y;
const gte=(x:unknown,y:unknown)=>finite(x)&&finite(y)&&x>=y;
const lt=(x:unknown,y:unknown)=>finite(x)&&finite(y)&&x<y;
const lte=(x:unknown,y:unknown)=>finite(x)&&finite(y)&&x<=y;
const hasHash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function evaluateGates(context:GateContext,evidence:Evidence|null):{checks:StageCheck[];reasons:string[]} {
 const {stage,entry}=context,checks:StageCheck[]=[];
 const add=(id:string,passed:boolean,actual:unknown,expected:string)=>checks.push({id,passed,actual:actual??null,expected});
 const m=evidence?.metrics??{},prior=context.previous??{},holdout=context.previousStage3??{};
 add('hypothesis',context.hypothesisVerified,context.hypothesisVerified,'registered economic rationale, target and kill criterion from #6');
 add('evidence',!!evidence,!!evidence,'actual run evidence from the designated source (never synthetic data)');
 if(evidence){
  add('stage',evidence.stage===stage,evidence.stage,'matching stage');
  add('strategy',evidence.strategyId.length>0&&evidence.version.length>0,evidence.strategyId+'/'+evidence.version,'matching registered strategy/version (verified by caller)');
  add('code_hash',evidence.codeHash===entry.codeHash,evidence.codeHash,'registered immutable code hash');
  add('config_hash',evidence.configHash===entry.configHash,evidence.configHash,'registered immutable config hash');
  add('data_hashes',Object.keys(evidence.dataHashes).length>0&&Object.values(evidence.dataHashes).every(hasHash),evidence.dataHashes,'one or more valid SHA-256 input hashes');
  add('source',evidence.source.startsWith('local:'),evidence.source,'local offline evidence only');
  const from=Date.parse(evidence.periodFrom+'T00:00:00Z'),to=Date.parse(evidence.periodToExclusive+'T00:00:00Z');
  const utcDate=(date:string,ms:number)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===date;
  add('time_window',utcDate(evidence.periodFrom,from)&&utcDate(evidence.periodToExclusive,to)&&from<to,
   [evidence.periodFrom,evidence.periodToExclusive],'valid positive UTC date window with real calendar dates');
 }
 const periodOk=(from:string,to:string)=>evidence?.periodFrom===from&&evidence.periodToExclusive===to;
 switch(stage){
  case 1: {
   add('development_split',periodOk('2020-01-01','2024-01-01'),evidence?[evidence.periodFrom,evidence.periodToExclusive]:null,'2020-01-01 to 2024-01-01 exclusive');
   add('backtest_green',m.trafficLight==='green',m.trafficLight,'#5 robustness light: green');
   add('lookahead_perturbation',m.lookaheadPassed===true&&hasHash(m.lookaheadEvidenceHash),
    {passed:m.lookaheadPassed??null,evidenceHash:m.lookaheadEvidenceHash??null},
    'all registered executable strategies passed reproducible offline perturbation test with SHA-256 evidence');
   add('beats_btc_and_dca', (gt(m.sharpe,m.btcSharpe)&&gt(m.sharpe,m.dcaSharpe))||
    (gt(m.calmar,m.btcCalmar)&&gt(m.calmar,m.dcaCalmar)),
    {sharpe:m.sharpe??null,calmar:m.calmar??null,btcSharpe:m.btcSharpe??null,btcCalmar:m.btcCalmar??null,dcaSharpe:m.dcaSharpe??null,dcaCalmar:m.dcaCalmar??null},
    'higher Sharpe than both BTC Buy & Hold and DCA, OR higher Calmar than both');
   add('deflated_sharpe',gte(m.dsrProbability,.95),m.dsrProbability,'DSR probability >= 0.95');
   add('pbo',gte(m.pbo,0)&&lt(m.pbo,.2),m.pbo,'PBO calculated and < 0.2');
   add('variants',m.variantsTested===entry.variantsTested,m.variantsTested,'honest hypothesis variantsTested');
   add('sample',gte(m.trades,100)||gte(m.exposureYears,3),{trades:m.trades??null,exposureYears:m.exposureYears??null},'>= 100 closed trades OR >= 3 years with exposure');
   add('gross_edge',gt(m.roundtripCost,0)&&gte(m.grossEdge,(finite(m.roundtripCost)?2*m.roundtripCost:NaN)),{grossEdge:m.grossEdge??null,roundtripCost:m.roundtripCost??null},'gross edge >= 2 * strictly positive roundtrip cost');
   add('bootstrap_band',finite(m.bootstrapP10)&&finite(m.bootstrapP90)&&lte(m.bootstrapP10,m.bootstrapP90),[m.bootstrapP10??null,m.bootstrapP90??null],'valid P10/P90 expectations for next stages');
   break;
  }
  case 2: {
   add('validation_split',periodOk('2024-01-01','2025-01-01'),evidence?[evidence.periodFrom,evidence.periodToExclusive]:null,'2024 calendar year only');
   add('bootstrap_p10',gte(m.netReturnPct,prior.bootstrapP10),m.netReturnPct,'net return >= development bootstrap P10');
   add('stress_nonnegative',Array.isArray(m.stressNetReturnsPct)&&m.stressNetReturnsPct.length>0&&m.stressNetReturnsPct.every((x:unknown)=>gte(x,0)),m.stressNetReturnsPct,'all stress-test net returns >= 0');
   break;
  }
  case 3: {
   add('holdout_split',!!evidence&&Date.parse(evidence.periodFrom+'T00:00:00Z')>=Date.parse('2025-01-01T00:00:00Z'),evidence?.periodFrom,'2025-01-01 or later');
   add('holdout_guard',context.holdoutGuardVerified,context.holdoutGuardVerified,'actual #3 holdout guard used, reason "pipeline stage 3" recorded');
   add('bootstrap_p10',gte(m.netReturnPct,prior.bootstrapP10),m.netReturnPct,'net return >= development bootstrap P10');
   break;
  }
  case 4: {
   const paperWindowDays=evidence?(Date.parse(evidence.periodToExclusive+'T00:00:00Z')-Date.parse(evidence.periodFrom+'T00:00:00Z'))/86400000:NaN;
   add('paper_90_days',gte(m.days,90),m.days,'>= 90 complete paper days on frozen version');
   add('paper_observed_window',gte(paperWindowDays,90)&&lte(m.days,paperWindowDays),
    {claimedDays:m.days??null,windowDays:Number.isFinite(paperWindowDays)?paperWindowDays:null},
    'paper evidence window covers all claimed days, at least 90 actual calendar days');
   add('paper_code_hash',m.paperCodeHash===entry.codeHash,m.paperCodeHash,'recorded frozen code hash matches');
   add('monitoring',m.neverRed===true&&hasHash(m.monitoringEvidenceHash),{neverRed:m.neverRed??null,monitoringEvidenceHash:m.monitoringEvidenceHash??null},'continuous #12 monitoring without red status, with evidence hash');
   add('expectation_band',gte(m.netReturnPct,prior.bootstrapP10)&&lte(m.netReturnPct,prior.bootstrapP90),m.netReturnPct,'within stage 1 P10..P90');
   add('paper_after_holdout',!!evidence&&!!holdout.passedAt&&Date.parse(evidence.periodFrom+'T00:00:00Z')>=Date.parse(String(holdout.passedAt)),evidence?.periodFrom,'paper starts after passed holdout');
   break;
  }
  case 5: {
   const testnetWindowDays=evidence?(Date.parse(evidence.periodToExclusive+'T00:00:00Z')-Date.parse(evidence.periodFrom+'T00:00:00Z'))/86400000:NaN;
   add('testnet_28_days',gte(m.days,28),m.days,'>= 28 complete testnet days');
   add('testnet_observed_window',gte(testnetWindowDays,28)&&lte(m.days,testnetWindowDays),
    {claimedDays:m.days??null,windowDays:Number.isFinite(testnetWindowDays)?testnetWindowDays:null},
    'testnet evidence window covers all claimed days, at least 28 actual calendar days');
   add('reconciliation',m.reconciliationErrors===0&&hasHash(m.reconciliationEvidenceHash),m.reconciliationErrors,'zero reconciliation errors backed by #9 evidence');
   add('paper_shadow',gte(m.fillDeviationBps,0)&&gte(m.fillToleranceBps,0)&&lte(m.fillDeviationBps,m.fillToleranceBps),{fillDeviationBps:m.fillDeviationBps??null,fillToleranceBps:m.fillToleranceBps??null},'measured fill deviation within predeclared paper-shadow tolerance');
   add('readiness_from_9',m.readinessPassed===true&&hasHash(m.readinessEvidenceHash),m.readinessPassed,'#9 readiness report passed, no duplicate readiness gates');
   break;
  }
  case 6: {
   add('report_only',m.reportOnly===true,m.reportOnly,'readiness report only; never unlock live orders');
   break;
  }
 }
 return {checks,reasons:checks.filter(c=>!c.passed).map(c=>`${c.id}: expected ${c.expected}`)};
}
