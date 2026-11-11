import type {Candle} from '@paper/shared';
import {digest} from '../provenance/build.js';import {canonicalJson} from '../research/dataset.js';
const STEP=900000,time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function decimal(v:unknown){if(typeof v!=='string'||v.length>80||!/^\d+(?:\.\d+)?$/.test(v))throw Error('invalid-decimal');const n=Number(v);if(!Number.isFinite(n)||n===0&&/[1-9]/.test(v))throw Error('unrepresentable-decimal');const[a,b='']=v.split('.'),whole=a!.replace(/^0+(?=\d)/,''),fraction=b.replace(/0+$/,'');return {text:whole+(fraction?'.'+fraction:''),number:n};}
function greater(a:string,b:string){const[x,y='']=a.split('.'),[u,v='']=b.split('.'),scale=Math.max(y.length,v.length);return BigInt(x!+y.padEnd(scale,'0'))>BigInt(u!+v.padEnd(scale,'0'));}
export function parseWsActivity(rawText:string,pair:string,receivedAt:number){
 const deny=(reason:string)=>({valid:false as const,reason});
 try{
  if(typeof rawText!=='string'||rawText.length>131072||!time(receivedAt)||typeof pair!=='string'||!(/^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/).test(pair))return deny('invalid-source-scope');
  const m:unknown=JSON.parse(rawText);if(!object(m)||m.stream!==pair.replace('/','').toLowerCase()+'@kline_15m'||!object(m.data)||m.data.e!=='kline'||m.data.s!==pair.replace('/','')||!object(m.data.k))return deny('source-stream-or-symbol-mismatch');
  const d=m.data,k=d.k;if(k.s!==d.s||k.i!=='15m'||k.x!==true||!time(k.t)||k.t%STEP||k.T!==k.t+STEP-1||!time(k.T)||!time(d.E)||d.E<k.T||!Number.isSafeInteger(k.t+STEP)||k.t+STEP>receivedAt+2000||d.E>receivedAt+2000||!time(k.n))return deny('nonfinal-invalid-or-future-source-clock');
  const fields=Object.fromEntries(['o','h','l','c','v','q','V','Q'].map(key=>[key,decimal(k[key])]));const n=(key:string)=>fields[key]!.number;
  if(n('l')<=0||greater(fields.l!.text,fields.o!.text)||greater(fields.l!.text,fields.c!.text)||greater(fields.o!.text,fields.h!.text)||greater(fields.c!.text,fields.h!.text)||greater(fields.V!.text,fields.v!.text)||greater(fields.Q!.text,fields.q!.text))return deny('invalid-price-or-taker-volume');
  const facts={pair,openAt:k.t,closedAt:k.t+STEP,decimals:Object.fromEntries(Object.entries(fields).map(([key,v])=>[key,v.text])),trades:k.n},barFactsHash=digest(canonicalJson(facts)),rawHash=digest(rawText),availableAfter=Math.max(receivedAt,k.t+STEP,d.E),candle:Candle={pair,interval:15,ts:k.t,open:n('o'),high:n('h'),low:n('l'),close:n('c'),volume:n('v')};
  return {valid:true as const,record:{version:'binance-ws-activity-bar-v1' as const,source:'wss://data-stream.binance.vision/stream',receiptDomain:'observed-local-ws-receipt-v1',pair,receivedAt,eventAt:d.E,availableAfter,closedAt:k.t+STEP,barFactsHash,rawHash,rawText,candle,quoteVolume:n('q'),trades:k.n,takerBuyBaseVolume:n('V'),takerBuyQuoteVolume:n('Q'),takerBuyBaseShare:n('v')>0?n('V')/n('v'):null,takerBuyQuoteShare:n('q')>0?n('Q')/n('q'):null}};
 }catch{return deny('invalid-or-unrepresentable-source-payload');}
}
export type WsActivityRecord=Extract<ReturnType<typeof parseWsActivity>,{valid:true}>['record'];
