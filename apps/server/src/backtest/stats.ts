/** Numerical tools used only by the backtest; no probability claims from insufficient samples. */
export const mean=(values:readonly number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
export function variance(values:readonly number[],sample=false) {
  if(values.length<(sample?2:1))return 0;
  const m=mean(values);return values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-(sample?1:0));
}
export const deviation=(values:readonly number[],sample=false)=>Math.sqrt(variance(values,sample));
export function quantile(sortedInput:readonly number[],q:number):number {
  if(!sortedInput.length)throw Error('Empty quantile');
  if(q<0||q>1)throw Error('Invalid quantile');
  const a=[...sortedInput].sort((x,y)=>x-y),pos=q*(a.length-1),lo=Math.floor(pos),hi=Math.ceil(pos);
  return a[lo]!+(a[hi]!-a[lo]!)*(pos-lo);
}
export function skewKurtosis(x:readonly number[]) {
  const mu=mean(x),sd=deviation(x);
  if(x.length<3||sd===0)return {skew:0,kurtosis:3};
  return {skew:mean(x.map(y=>((y-mu)/sd)**3)),kurtosis:mean(x.map(y=>((y-mu)/sd)**4))};
}
// Abramowitz-Stegun normal CDF approximation (max absolute error ~7.5e-8).
export function normalCdf(x:number):number {
  const z=Math.abs(x),t=1/(1+.2316419*z),poly=t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  const p=1-Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*poly;
  return x>=0?p:1-p;
}
// Peter Acklam's inverse standard normal rational approximation.
export function normalInv(p:number):number {
  if(p<=0)return -Infinity;if(p>=1)return Infinity;
  const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924];
  const b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857];
  const c=[-0.00778489400243029,-0.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878];
  const d=[0.00778469570904146,0.32246712907004,2.445134137143,3.75440866190742];
  if(p<.02425||p>1-.02425){
    const q=Math.sqrt(-2*Math.log(Math.min(p,1-p)));
    const x=(((((c[0]!*q+c[1]!)*q+c[2]!)*q+c[3]!)*q+c[4]!)*q+c[5]!)/((((d[0]!*q+d[1]!)*q+d[2]!)*q+d[3]!)*q+1);
    return p<.5?x:-x;
  }
  const q=p-.5,r=q*q;
  return (((((a[0]!*r+a[1]!)*r+a[2]!)*r+a[3]!)*r+a[4]!)*r+a[5]!)*q/
    (((((b[0]!*r+b[1]!)*r+b[2]!)*r+b[3]!)*r+b[4]!)*r+1);
}
export function sharpeDaily(returns:readonly number[]) {
  const sd=deviation(returns,true);return returns.length>1&&sd>0?mean(returns)/sd:0;
}
/** Bailey & López de Prado (2014), threshold accounts for number of trials and non-normal returns. */
export function deflatedSharpe(returns:readonly number[],trials:number):number|null {
  if(!Number.isInteger(trials)||trials<1)throw Error('Invalid trials count');
  if(returns.length<3)return null;
  const sr=sharpeDaily(returns),{skew,kurtosis}=skewKurtosis(returns);
  const srVariance=Math.max(1e-12,(1-skew*sr+(kurtosis-1)*sr*sr/4)/(returns.length-1));
  const std=Math.sqrt(srVariance),gamma=.5772156649015329;
  const threshold=trials===1?0:std*((1-gamma)*normalInv(1-1/trials)+gamma*normalInv(1-1/(trials*Math.E)));
  return normalCdf((sr-threshold)/std);
}
/** CSCV: all 16-choose-8 balanced IS/OOS partitions. Rank the IS winner OOS, count logit(rank)<0. */
export function probabilityOfBacktestOverfitting(variants:readonly (readonly number[])[],blocks=16):number|null {
  if(variants.length<2)return null;
  if(blocks!==16)throw Error('CSCV requires S=16');
  const length=variants[0]?.length??0;
  if(length<16||variants.some(v=>v.length!==length||v.some(x=>!Number.isFinite(x))))return null;
  const groups=Array.from({length:16},(_,i)=>({start:Math.floor(i*length/16),end:Math.floor((i+1)*length/16)}));
  let n=0,failed=0;
  for(let mask=0;mask<65536;mask++){
    let bits=0;for(let x=mask;x;x&=x-1)bits++;
    if(bits!==8)continue;
    const training:number[][]=variants.map(()=>[]),testing:number[][]=variants.map(()=>[]);
    for(let b=0;b<16;b++)for(let v=0;v<variants.length;v++){
      (mask&(1<<b)?training:testing)[v]!.push(...variants[v]!.slice(groups[b]!.start,groups[b]!.end));
    }
    const inScores=training.map(sharpeDaily),outScores=testing.map(sharpeDaily);
    const winner=inScores.indexOf(Math.max(...inScores));
    const below=outScores.filter(x=>x<outScores[winner]!).length;
    const ties=outScores.filter(x=>x===outScores[winner]!).length;
    const percentile=(below+ties/2)/variants.length;
    if(percentile<.5)failed++;n++;
  }
  return n?failed/n:null;
}
export function maxDrawdown(equities:readonly number[]):number {
  let peak=0,dd=0;for(const e of equities){peak=Math.max(peak,e);if(peak>0)dd=Math.max(dd,(peak-e)/peak);}return dd;
}
