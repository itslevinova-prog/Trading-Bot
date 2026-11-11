import {createHmac} from 'node:crypto';
export type TradingEnvironment='testnet'|'live';
export const tradingBase=(environment:TradingEnvironment)=>environment==='testnet'?'https://testnet.binance.vision':'https://api.binance.com';
export class NativePreSendRejected extends Error{constructor(){super('Native mutation not sent: final synchronous guard rejected');}}
export class ExchangeError extends Error{constructor(public status:number,public code:number|undefined){super(`Binance HTTP ${status}, code ${code??'unknown'} (response redacted)`);}}
function permittedRequest(method:string,path:string,signed:boolean){
 const publicReads=new Set(['/api/v3/time','/api/v3/exchangeInfo','/api/v3/depth','/api/v3/klines','/api/v3/ticker/24hr']);
 const privateReads=new Set(['/api/v3/account','/api/v3/openOrders','/api/v3/order','/api/v3/orderList','/api/v3/myTrades']);
 if(!(signed?method==='GET'&&privateReads.has(path)||method==='POST'&&path==='/api/v3/orderList/opoco':method==='GET'&&publicReads.has(path)))throw Error('Endpoint or method not permitted');
}
export class BinanceClient {
 private offset=0;private clockAt=0;
 constructor(readonly environment:TradingEnvironment,private apiKey:string,private secret:string,private request:typeof fetch=fetch){}
 async public<T>(path:string,params:Record<string,string>={}):Promise<T>{return this.send<T>('GET',path,params,false);}
 async syncClock(){const start=Date.now(),time=await this.public<{serverTime:number}>('/api/v3/time');const end=Date.now();if(!Number.isFinite(time.serverTime)||end<start||end-start>3000)throw Error('Börsenzeit nicht zuverlässig');this.offset=time.serverTime-(start+end)/2;this.clockAt=end;}
 async signed<T>(method:'GET'|'POST'|'DELETE',path:string,params:Record<string,string>={},beforeSend?:()=>void):Promise<T>{
  permittedRequest(method,path,true);
  if(!this.apiKey||!this.secret)throw Error('Keine Börsen-Zugangsdaten; Anfrage blockiert');
  if(this.clockAt>Date.now()||Date.now()-this.clockAt>60000)await this.syncClock();
  return this.send<T>(method,path,{...params,recvWindow:'5000',timestamp:String(Math.floor(Date.now()+this.offset))},true,beforeSend);
 }
 private async send<T>(method:string,path:string,params:Record<string,string>,signed:boolean,beforeSend?:()=>void):Promise<T>{
  // Private client cannot reach withdrawal, transfer, margin or futures endpoints.
  permittedRequest(method,path,signed);
  const payload=new URLSearchParams(params);if(signed)payload.set('signature',createHmac('sha256',this.secret).update(payload.toString()).digest('hex'));
  const url=new URL(path,tradingBase(this.environment));const isRead=method==='GET';if(isRead)url.search=payload.toString();
  if(beforeSend){try{const value:unknown=beforeSend();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('Guard must be synchronous');}}catch{throw new NativePreSendRejected();}}
  let response:Response;try{response=await this.request(url,{method,redirect:'error',signal:AbortSignal.timeout(12000),headers:{...(signed?{'X-MBX-APIKEY':this.apiKey}:{}),...(!isRead?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(!isRead?{body:payload.toString()}:{})});}catch{throw Error('Börsenanfrage ohne eindeutige Antwort; niemals automatisch erneut senden');}
  const body=await response.json().catch(()=>null) as any;
  if(!response.ok)throw new ExchangeError(response.status,typeof body?.code==='number'?body.code:undefined);
  return body as T;
 }
}
