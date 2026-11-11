export type Account={id:string;name:string;strategy:string;cash:number;equity:number|null;pnlEur:number|null;pnlPct:number|null;fees:number;positionCount:number;status:string;peakEquity:number;drawdownPct:number|null;valuation:{complete:boolean;unvaluedPairs:string[]}};
export type Pair={symbol:string;restName:string;lotDecimals:number;volume24hEur:number;bookFresh:boolean;ticker?:{bid:number;ask:number;last:number;change24h:number;volume:number;receivedAt:number};feature?:{rsi14:number;volumeRatio:number;change1h:number;change24h:number;ema20:number;ema50:number;spreadPct:number};book?:{bids:{price:string;qty:string}[];asks:{price:string;qty:string}[]}};
export type Trade={id:string;accountId:string;pair:string;side:string;qty:number;fillPrice:number;feeEur:number;costEur:number;slippageBps:number;latencyMs:number;reason:string;realizedPnlEur:number|null;ts:number};
export type Position={id:string;accountId:string;pair:string;qty:number;avgEntryPrice:number;value:number|null;pnlEur:number|null;pnlPct:number|null;valuationStatus:string;priceAsOf:number|null;stopLossPrice:number|null;takeProfitPrice:number|null};
export type Decision={id:string;accountId:string;provider:string;ts:number;status:string;marketView:string;actionsJson:string;contextJson:string;promptText:string;rawResponse:string};
export type Snapshot={accountId:string;ts:number;equity:number;cash:number};
export type Lesson={id:string;text:string;source:string;active:boolean;createdAt:number};
export async function get<T>(path:string):Promise<T>{const r=await fetch('/api'+path);if(!r.ok){const body=await r.json().catch(()=>({error:'Anfrage fehlgeschlagen'})) as {error?:string};throw Error(body.error??`${r.status}: ${path}`)}return r.json() as Promise<T>}
export async function post<T>(path:string,body?:unknown,method='POST'):Promise<T>{const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body===undefined?{}:body)});if(!r.ok){const raw=await r.text();try{const body=JSON.parse(raw);throw Error(body.error??raw)}catch(e){if(e instanceof SyntaxError)throw Error(raw);throw e}}return r.json() as Promise<T>}
let displayQuote='EUR';
export const setDisplayQuote=(quote:string)=>{displayQuote=quote;};
export const quoteLabel=()=>displayQuote;
export const money=(n:number|null)=>n===null?'Unbekannt':new Intl.NumberFormat('en-CH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)+' '+(displayQuote==='EUR'?'€':displayQuote);
export const num=(n:number|null,d=2)=>n===null?'–':new Intl.NumberFormat('en-CH',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
export const time=(ms:number)=>new Intl.DateTimeFormat('de-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'medium'}).format(ms);
export const pct=(n:number|null)=>n===null?'Unbekannt':`${n>0?'+':''}${num(n)} %`;
