import type {Candle} from '@paper/shared';
import {digest} from '../provenance/build.js';import {canonicalJson} from '../research/dataset.js';
const STEP=900000,N=192;
export type CovariancePanel={version:'aligned-covariance-v1';asOf:number;anchorClosedAt:number;lastClosedAt:number;returns:number;pairs:string[];valid:boolean[];lastCloses:(number|null)[];covariance:(number|null)[][];sourceClosesHash:string;hash:string};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function alignedPortfolioCovariance(inputs:{pair:string;candles:Candle[]}[],now:number):CovariancePanel{
 if(!Number.isSafeInteger(now)||now<0||!inputs.length||new Set(inputs.map(i=>i.pair)).size!==inputs.length||inputs.some(i=>typeof i.pair!=='string'||!i.pair))throw Error('Invalid covariance inputs');
 const end=Math.floor(now/STEP)*STEP,from=end-(N+1)*STEP,sorted=[...inputs].sort((a,b)=>a.pair.localeCompare(b.pair)),vectors:(number[]|null)[]=[],closes:(number[]|null)[]=[];
 for(const input of sorted){
  const rows=input.candles.filter(c=>c.pair===input.pair&&c.interval===15&&c.ts>=from&&c.ts<end).sort((a,b)=>a.ts-b.ts);
  const valid=rows.length===N+1&&rows.every((c,i)=>c.ts===from+i*STEP&&[c.open,c.high,c.low,c.close,c.volume].every(finite)&&c.low>0&&c.volume>=0&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close));
  if(!valid){vectors.push(null);closes.push(null);continue;}
  const raw=rows.slice(1).map((c,i)=>Math.log(c.close)-Math.log(rows[i]!.close)),mean=raw.reduce((a,b)=>a+b,0)/N;
  vectors.push(raw.map(r=>r-mean));closes.push(rows.map(c=>c.close));
 }
 const covariance=sorted.map((_,i)=>sorted.map((_,j)=>{const x=vectors[i],y=vectors[j];if(!x||!y)return null;const value=x.reduce((n,v,k)=>n+v*y[k]!,0)/(N-1);if(!finite(value))throw Error('Unstable covariance');return value;}));
 const facts:Omit<CovariancePanel,'hash'>={version:'aligned-covariance-v1',asOf:now,anchorClosedAt:end-N*STEP,lastClosedAt:end,returns:N,pairs:sorted.map(i=>i.pair),valid:vectors.map(v=>v!==null),lastCloses:closes.map(v=>v?.at(-1)??null),covariance,sourceClosesHash:digest(canonicalJson(closes))};
 return {...facts,hash:digest(canonicalJson(facts))};
}
// Check the required block in unit-variance coordinates. A pivoted Schur
// complement also accepts singular matrices from perfectly correlated assets.
function validateCovarianceBlock(panel: CovariancePanel, indices: number[]) {
 const error = () => new Error('Invalid covariance matrix');
 const tolerance = 1e-10;
 const std = indices.map(i => Math.sqrt(panel.covariance[i]![i]!));
 const block = indices.map((i, row) => indices.map((j, col) => {
  const value = panel.covariance[i]![j]!;
  if (value !== panel.covariance[j]![i]) throw error();
  return row === col ? 1 : value / std[row]! / std[col]!;
 }));
 if (block.some(row => row.some(value => !finite(value) || Math.abs(value) > 1 + tolerance))) throw error();

 const remaining = block.map((_, i) => i);
 while (remaining.length) {
  const pivot = remaining.reduce((best, i) => block[i]![i]! > block[best]![best]! ? i : best);
  const diagonal = block[pivot]![pivot]!;
  if (diagonal <= tolerance) {
   if (remaining.some(i => remaining.some(j => Math.abs(block[i]![j]!) > tolerance))) throw error();
   return;
  }
  remaining.splice(remaining.indexOf(pivot), 1);
  for (const i of remaining) for (const j of remaining) {
   block[i]![j] = block[i]![j]! - block[i]![pivot]! * block[pivot]![j]! / diagonal;
  }
 }
}

/** No covariance credit can raise the original budget. Currency exposures avoid an invented post-fill equity. */
export function covarianceBudget(panel:CovariancePanel,now:number,pair:string,newExposure:number,holdings:{pair:string;value:number}[]){
 const {hash,...facts}=panel;
 if (!Number.isSafeInteger(now) || now < 0 || !Array.isArray(panel.pairs) ||
     panel.pairs.some(pair => typeof pair !== 'string' || !pair) ||
     new Set(panel.pairs).size !== panel.pairs.length) {
  throw Error('Invalid covariance budget inputs');
 }
 if(hash!==digest(canonicalJson(facts))||panel.version!=='aligned-covariance-v1'||panel.asOf!==now||panel.lastClosedAt!==Math.floor(now/STEP)*STEP||panel.anchorClosedAt!==panel.lastClosedAt-N*STEP||panel.returns!==N||!finite(newExposure)||newExposure<=0||new Set(holdings.map(p=>p.pair)).size!==holdings.length||holdings.some(p=>p.pair===pair||!finite(p.value)||p.value<=0))throw Error('Invalid covariance budget inputs');
 const pairs=[pair,...holdings.map(p=>p.pair)],indices=pairs.map(p=>panel.pairs.indexOf(p));
 if(indices.some(i=>i<0||panel.valid[i]!==true)||indices.some(i=>indices.some(j=>!finite(panel.covariance[i]?.[j])))||indices.some(i=>panel.covariance[i]![i]!<=0))throw Error('Unknown or uninformative required covariance');
 validateCovarianceBlock(panel,indices);
 const c=indices[0]!,standalone=newExposure**2*panel.covariance[c]![c]!,cross=newExposure*holdings.reduce((n,p,j)=>n+p.value*panel.covariance[c]![indices[j+1]!]!,0);
 let heldVariance=0;for(let i=0;i<holdings.length;i++)for(let j=0;j<holdings.length;j++)heldVariance+=holdings[i]!.value*holdings[j]!.value*panel.covariance[indices[i+1]!]![indices[j+1]!]!;
 const z=Math.max(0,cross/standalone),factor=1/(Math.hypot(1,z)+z),before=heldVariance+standalone+2*cross,after=heldVariance+standalone*factor**2+2*cross*factor,independentIncrementReference=heldVariance+standalone;
 if(![standalone,cross,heldVariance,factor,before,after].every(finite)||standalone<=0||factor<=0||factor>1||heldVariance< -1e-9||after>independentIncrementReference+Math.max(1,Math.abs(independentIncrementReference))*1e-10)throw Error('Unstable covariance budget');
 return {factor,heldVariance,standaloneCandidateVariance:standalone,crossTermHalf:cross,beforeVariance:Math.max(0,before),afterVariance:Math.max(0,after),independentIncrementReference,scope:'Sampled log-linear currency-PnL variance, not forecast/stop/tail guarantee' as const};
}
