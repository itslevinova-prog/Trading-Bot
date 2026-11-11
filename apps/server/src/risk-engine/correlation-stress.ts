import {
  assetRiskVectors,DEFAULT_RISK_LIMITS,
  type RiskLimits,type RiskSnapshot
} from './engine.js';

/** A fixed adverse assumption, never selected by scanning outcome data. */
export const CORRELATION_STRESS_ASSUMPTION={
  version:'correlation-jump-stress-v1',
  pairwiseFloor:.95,
  tailSigma:2.33,
  observedDailyReturns:60
} as const;

export type CorrelationStressReport={
  version:'correlation-jump-stress-v1';
  status:'diagnostic'|'insufficient_evidence';
  reason:string|null;
  asOf:number;
  observedDailyReturns:60|null;
  positions:number;
  assumedPairwiseCorrelationFloor:.95;
  baselineTailLossPct:number|null;
  stressedTailLossPct:number|null;
  baselineAnnualVol:number|null;
  stressedAnnualVol:number|null;
  baselineClusterPct:number|null;
  stressedClusterPct:number|null;
  baselineFreeTailBudgetPct:number|null;
  stressedFreeTailBudgetPct:number|null;
  baselineFreeClusterBudgetPct:number|null;
  stressedFreeClusterBudgetPct:number|null;
  note:string;
};
const NOTE='Read-only correlated-tail scenario on the same 60 completed historical daily returns and pre-existing positions. This is an assumption, not a forecast, an independent strategy edge, or permission for a new order.';
function covariance(a:readonly number[],b:readonly number[]):number {
  if(a.length!==b.length||a.length<2)throw Error('Covariance needs matching observations');
  const am=a.reduce((s,v)=>s+v,0)/a.length;
  const bm=b.reduce((s,v)=>s+v,0)/b.length;
  return a.reduce((s,v,i)=>s+(v-am)*(b[i]!-bm),0)/(a.length-1);
}
function largestConnectedCluster(weights:readonly number[],correlations:readonly (readonly number[])[]):number {
  let maximum=0;
  const seen=new Set<number>();
  for(let i=0;i<weights.length;i++){
    if(seen.has(i))continue;
    let total=0;
    const stack=[i];seen.add(i);
    while(stack.length){
      const current=stack.pop()!;
      total+=weights[current]!;
      for(let other=0;other<weights.length;other++)
        if(!seen.has(other)&&correlations[current]![other]!>=.8){
          seen.add(other);stack.push(other);
        }
    }
    maximum=Math.max(maximum,total);
  }
  return maximum;
}

/**
 * Compare realized same-day dependence to an adverse synchronized correlation
 * jump. Keep each asset's observed variance and existing position weights.
 * A stress floor cannot replace observed stronger positive correlations.
 */
export function correlationJumpStress(snapshot:RiskSnapshot,
 limits:RiskLimits=DEFAULT_RISK_LIMITS):CorrelationStressReport {
  const base={
    version:'correlation-jump-stress-v1' as const,asOf:snapshot.asOf,
    positions:snapshot.positions?.length??0,
    assumedPairwiseCorrelationFloor:CORRELATION_STRESS_ASSUMPTION.pairwiseFloor,
    note:NOTE
  };
  const unavailable=(reason:string):CorrelationStressReport=>({
    ...base,status:'insufficient_evidence',reason,observedDailyReturns:null,
    baselineTailLossPct:null,stressedTailLossPct:null,
    baselineAnnualVol:null,stressedAnnualVol:null,
    baselineClusterPct:null,stressedClusterPct:null,
    baselineFreeTailBudgetPct:null,stressedFreeTailBudgetPct:null,
    baselineFreeClusterBudgetPct:null,stressedFreeClusterBudgetPct:null
  });
  if(!Number.isSafeInteger(snapshot.asOf)||snapshot.asOf<0||
     !Number.isFinite(snapshot.equity)||snapshot.equity<=0||
     !Number.isFinite(snapshot.cash)||snapshot.cash<0||
     !Array.isArray(snapshot.positions)||!snapshot.positions.length||
     snapshot.positions.some(p=>!p.pair||!Number.isFinite(p.marketValue)||p.marketValue<=0)||
     new Set(snapshot.positions.map(p=>p.pair)).size!==snapshot.positions.length||
     !Number.isFinite(limits.targetAnnualVol)||limits.targetAnnualVol<=0||
     !Number.isFinite(limits.maxClusterPct)||limits.maxClusterPct<=0||limits.maxClusterPct>1)
    return unavailable('Account or frozen risk limits are invalid or contain no known positions.');
  const invested=snapshot.positions.reduce((sum,p)=>sum+p.marketValue,0);
  if(invested>snapshot.equity+1e-8||Math.abs(snapshot.equity-invested-snapshot.cash)>1e-6)
    return unavailable('Positions, cash and equity are not in one reconciled quote valuation.');
  const names=[...new Set(['BTCUSDT',...snapshot.positions.map(p=>p.pair)])];
  const observed=assetRiskVectors(snapshot,names);
  if(!observed)return unavailable('Missing, stale, non-contiguous or zero-variance 60-day risk history.');
  const vectors=snapshot.positions.map(p=>observed.find(v=>v.pair===p.pair)!);
  if(vectors.some(v=>!v||v.returns.length!==60))
    return unavailable('No common 60 completed daily returns for every existing position.');
  const weights=snapshot.positions.map(p=>p.marketValue/snapshot.equity);
  const n=weights.length;
  const vols=vectors.map(v=>Math.sqrt(covariance(v.returns,v.returns)));
  const correlations=vectors.map((a,i)=>vectors.map((b,j)=>
    i===j?1:Math.max(-1,Math.min(1,covariance(a.returns,b.returns)/(vols[i]!*vols[j]!)))));
  if(vols.some(v=>!Number.isFinite(v)||v<=0)||
     correlations.some(row=>row.some(v=>!Number.isFinite(v))))
    return unavailable('Unrepresentable covariance or volatility.');
  let baselineVariance=0,stressedVariance=0;
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++){
      const baseCov=vols[i]!*vols[j]!*correlations[i]![j]!;
      const stressedRho=i===j?1:Math.max(correlations[i]![j]!,CORRELATION_STRESS_ASSUMPTION.pairwiseFloor);
      baselineVariance+=weights[i]!*weights[j]!*baseCov;
      stressedVariance+=weights[i]!*weights[j]!*vols[i]!*vols[j]!*stressedRho;
    }
  }
  if(!Number.isFinite(baselineVariance)||!Number.isFinite(stressedVariance))
    return unavailable('Unrepresentable portfolio tail covariance.');
  const baselineSigma=Math.sqrt(Math.max(0,baselineVariance));
  const stressedSigma=Math.sqrt(Math.max(0,stressedVariance));
  const tailLoss=(sigma:number)=>1-Math.exp(-CORRELATION_STRESS_ASSUMPTION.tailSigma*sigma);
  const baselineTailLossPct=tailLoss(baselineSigma);
  const stressedTailLossPct=tailLoss(stressedSigma);
  const baselineClusterPct=largestConnectedCluster(weights,correlations);
  const stressedClusterPct=weights.reduce((s,x)=>s+x,0);
  const tailBudget=tailLoss(limits.targetAnnualVol/Math.sqrt(365));
  const remaining=(budget:number,usage:number)=>Math.max(0,budget-usage);
  const values=[
    baselineTailLossPct,stressedTailLossPct,baselineClusterPct,stressedClusterPct,tailBudget
  ];
  if(values.some(x=>!Number.isFinite(x))||
     stressedTailLossPct+1e-9<baselineTailLossPct||
     stressedClusterPct+1e-9<baselineClusterPct)
    return unavailable('Invalid or risk-reducing correlation stress calculation.');
  return {...base,status:'diagnostic',reason:null,observedDailyReturns:60,
    baselineTailLossPct,stressedTailLossPct,
    baselineAnnualVol:baselineSigma*Math.sqrt(365),
    stressedAnnualVol:stressedSigma*Math.sqrt(365),
    baselineClusterPct,stressedClusterPct,
    baselineFreeTailBudgetPct:remaining(tailBudget,baselineTailLossPct),
    stressedFreeTailBudgetPct:remaining(tailBudget,stressedTailLossPct),
    baselineFreeClusterBudgetPct:remaining(limits.maxClusterPct,baselineClusterPct),
    stressedFreeClusterBudgetPct:remaining(limits.maxClusterPct,stressedClusterPct)};
}
