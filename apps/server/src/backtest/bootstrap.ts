import {maxDrawdown,quantile} from './stats.js';
export type BootstrapBands={paths:number;blockLength:number;seed:number;endReturn:{p10:number;p50:number;p90:number};maxDrawdown:{p10:number;p50:number;p90:number}};
function generator(seed:number) {
  let s=(seed>>>0)||0x9e3779b9;
  return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}
/** Politis/Romano stationary bootstrap: restart a circular block with probability 1/L. */
export function stationaryBootstrap(returns:readonly number[],seed=1,paths=1000,blockLength=10):BootstrapBands|null {
  if(!returns.length)return null;
  if(!Number.isInteger(paths)||paths<1||!Number.isFinite(blockLength)||blockLength<=0||!Number.isInteger(seed)||returns.some(x=>!Number.isFinite(x)||x<=-1))
    throw Error('Invalid stationary bootstrap input');
  const rand=generator(seed),ends:number[]=[],drawdowns:number[]=[];
  for(let p=0;p<paths;p++){
    let index=Math.floor(rand()*returns.length),equity=1;
    const values=[equity];
    for(let i=0;i<returns.length;i++){
      if(i>0){if(rand()<1/blockLength)index=Math.floor(rand()*returns.length);else index=(index+1)%returns.length;}
      equity*=1+returns[index]!;values.push(equity);
    }
    ends.push(equity-1);drawdowns.push(maxDrawdown(values));
  }
  const bands=(a:number[])=>({p10:quantile(a,.10),p50:quantile(a,.50),p90:quantile(a,.90)});
  return {paths,blockLength,seed,endReturn:bands(ends),maxDrawdown:bands(drawdowns)};
}
