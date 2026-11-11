/** Descriptive closed-feature groups, not learned states, probabilities or a trade rule. */
export function closedVectorRiskRegime(x:readonly number[]){
 if(!Array.isArray(x)||x.length!==8||!Array.from(x).every(Number.isFinite)||x[0]!<0||x[0]!>1||[x[1],x[2],x[3],x[4],x[5]].some(v=>v!<=-100)||x[6]!<=0||x[7]!<0)throw Error('Invalid closed feature vector');
 const direction=x[1]!>0&&x[2]!>0&&x[4]!>0?'bullish':x[1]!<0&&x[2]!<0&&x[4]!<0?'bearish':'mixed';
 const stopPct=Math.max(.02,2*x[6]!/100),sourcePolicyStopAtrMultiple=stopPct/(x[6]!/100),fixedStopAtrMultiple=.02/(x[6]!/100);
 if(![sourcePolicyStopAtrMultiple,fixedStopAtrMultiple].every(Number.isFinite))throw Error('Unbounded vector risk geometry');
 return {version:'closed-vector-risk-regime-v1' as const,direction,volumeConfirmed:x[7]!>=1.2,sourcePolicyFloorBinding:x[6]!<1,referenceSourceStopPct:stopPct,sourcePolicyStopAtrMultiple,fixedStopAtrMultiple,scope:'Existing EMA-level/4h-sign agreement and volume boundary. Reference source2ATR/floor geometry is before hard-limit eligibility; fixed model stop is2percent regardless of ATR. Not a calibrated edge.'};
}
