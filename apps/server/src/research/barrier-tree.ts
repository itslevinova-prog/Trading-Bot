import {barrierTargetHash,type BarrierTarget} from './first-barrier-outcome.js';import {digest} from '../provenance/build.js';import {canonicalJson} from './dataset.js';
type Node={feature:number;threshold:number;left:number;right:number;value:number};
export type BarrierTreeBody={version:'barrier-gbr-tree-v1';featureSchema:'closed-bounded750-vector8-v1';target:BarrierTarget;targetHash:string;trainedAt:number;lastLabelEnd:number;knownLabels:number;ambiguousLabels:number;sklearnVersion:'1.7.2';parameters:{loss:'squared_error';n_estimators:100;learning_rate:.05;max_depth:2;min_samples_leaf:40;subsample:1;random_state:0;n_iter_no_change:null};baseline:number;means:number[];stds:number[];trees:Node[][]};
export type BarrierTree=BarrierTreeBody&{hash:string};
const dense8=(v:unknown):v is number[]=>Array.isArray(v)&&v.length===8&&Array.from(v).every(Number.isFinite);
const params={loss:'squared_error',n_estimators:100,learning_rate:.05,max_depth:2,min_samples_leaf:40,subsample:1,random_state:0,n_iter_no_change:null};
function validate(m:BarrierTreeBody){
 if(!m||m.version!=='barrier-gbr-tree-v1'||m.featureSchema!=='closed-bounded750-vector8-v1'||m.sklearnVersion!=='1.7.2'||barrierTargetHash(m.target)!==m.targetHash||m.target.horizonBars!==32||m.target.stopLossPct!==.02||m.target.takeProfitPct!==.04||canonicalJson(m.parameters)!==canonicalJson(params)||![m.trainedAt,m.lastLabelEnd,m.knownLabels,m.ambiguousLabels].every(n=>Number.isSafeInteger(n)&&n>=0)||m.knownLabels<200||m.lastLabelEnd>=m.trainedAt||!Number.isFinite(m.baseline)||!dense8(m.means)||!dense8(m.stds)||m.stds.some(v=>v<=0)||!Array.isArray(m.trees)||m.trees.length!==100)throw Error('Invalid tree model contract');
 for(const nodes of m.trees){if(!Array.isArray(nodes)||nodes.length<1||nodes.length>7)throw Error('Invalid tree size');const parents=Array(nodes.length).fill(0),depth=Array(nodes.length).fill(0);
  for(let i=0;i<nodes.length;i++){const n=nodes[i];if(!n||![n.feature,n.left,n.right].every(Number.isSafeInteger)||![n.threshold,n.value].every(Number.isFinite))throw Error('Invalid tree node');
   if(n.left===-1&&n.right===-1){if(n.feature!==-2)throw Error('Invalid tree leaf');continue;}
   if(n.feature<0||n.feature>=8||n.left<=i||n.right<=i||n.left>=nodes.length||n.right>=nodes.length||n.left===n.right||depth[i]>=2)throw Error('Invalid tree topology');parents[n.left]++;parents[n.right]++;depth[n.left]=depth[i]+1;depth[n.right]=depth[i]+1;
  }if(parents[0]!==0||parents.slice(1).some(n=>n!==1))throw Error('Disconnected or shared tree nodes');
 }
}
export function sealBarrierTree(raw:unknown,target:BarrierTarget):BarrierTree{const body=structuredClone(raw) as BarrierTreeBody;validate(body);if(body.targetHash!==barrierTargetHash(target))throw Error('Mixed tree target');return {...body,hash:digest(canonicalJson(body))};}
/** Portable numeric inference only. No pickle, eval, Python process or model provider. */
export function predictBarrierTree(m:BarrierTree,x:number[],asOf:number,expected:BarrierTarget):number|null{
 try{validate(m);if(!Number.isSafeInteger(asOf)||asOf<m.trainedAt||asOf-m.trainedAt>864000000||asOf-m.lastLabelEnd>864000000||barrierTargetHash(expected)!==m.targetHash||!dense8(x))return null;const {hash,...body}=m;if(digest(canonicalJson(body))!==hash)return null;
  if(x.some((v,i)=>!Number.isFinite((v-m.means[i]!)/m.stds[i]!)||Math.abs((v-m.means[i]!)/m.stds[i]!)>6))return null;
  const values=x.map(Math.fround);if(!values.every(Number.isFinite))return null;let value=m.baseline;
  for(const nodes of m.trees){let i=0;while(nodes[i]!.left!==-1){const n=nodes[i]!;i=values[n.feature]!<=n.threshold?n.left:n.right;}value+=m.parameters.learning_rate*nodes[i]!.value;}
  return Number.isFinite(value)?value:null;
 }catch{return null;}
}
