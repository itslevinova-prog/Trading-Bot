import type Database from 'better-sqlite3';
import {loadAccounts,loadTrades,readIdentity} from './ledger.js';
import type {TaxAccount} from './ledger.js';

export const yearStart=(year:number)=>Date.UTC(year,0,1)-3600000;
export const yearEnd=(year:number)=>Date.UTC(year+1,0,1)-3600000-1;
export type Holding = {account:string;accountName:string;network:string;exchange:string;asset:string;quote:string;
  qty:number;price:number|null;value:number|null;priceDate:string;priceSource:string;cash:boolean};
export type CashReconciliation = {account:string;expected:number;actual:number|null;difference:number|null;reconciled:boolean|null};

export function buildHoldings(db:Database.Database,year:number,accountId?:string):{holdings:Holding[];cashChecks:CashReconciliation[]} {
  if(!Number.isInteger(year)||year<2000||year>2100)throw Error('Ungültiges Steuerjahr');
  const end=yearEnd(year),identity=readIdentity(db),accounts=loadAccounts(db,accountId).filter(a=>a.createdAt<=end);
  const ids=new Set(accounts.map(a=>a.id)),cash=new Map(accounts.map(a=>[a.id,a.startingBalance]));
  const amounts=new Map<string,number>();
  for(const t of loadTrades(db,{accountId,to:end})){
    if(!ids.has(t.accountId))throw Error('Trade gehört zu unbekanntem Konto: '+t.id);
    const [base,quote]=t.pair.split('/');
    if(!base||quote!==identity.quote)throw Error('Unpassende Paar-Identität: '+t.id);
    const k=t.accountId+'|'+base,old=amounts.get(k)??0;
    const qty=old+(t.side==='buy'?t.qty:-t.qty);
    if(qty< -1e-8)throw Error('Negativer Bestand aus Trade-Journal: '+t.id);
    amounts.set(k,Math.abs(qty)<1e-10?0:qty);
    cash.set(t.accountId,(cash.get(t.accountId)??0)+(t.side==='buy'?-(t.costEur+t.feeEur):t.costEur-t.feeEur));
  }
  const output:Holding[]=[];
  for(const a of accounts){
    for(const [k,qty] of amounts){
      if(!k.startsWith(a.id+'|')||qty<=1e-10)continue;
      const asset=k.slice(a.id.length+1);
      const pair=asset+'/'+identity.quote;
      // Candle timestamps are opening times; only fully closed candles qualify.
      const candle=db.prepare('SELECT close,ts,interval FROM candles WHERE pair=? AND (ts+interval*60000)<=? ORDER BY (ts+interval*60000) DESC,interval ASC LIMIT 1').get(pair,end) as {close:number;ts:number;interval:number}|undefined;
      const close=candle&&Number.isFinite(candle.close)&&candle.close>0?candle.close:null;
      output.push({account:a.id,accountName:a.name,network:identity.network,exchange:identity.exchange,
        asset,quote:identity.quote,qty,price:close,value:close===null?null:qty*close,
        priceDate:candle&&close!==null?new Date(candle.ts+candle.interval*60000).toISOString():'',
        priceSource:candle&&close!==null?'Lokale candles (letzter geschlossener '+candle.interval+'m-Schluss)':'Kein geschlossener Kurs vorhanden',cash:false});
    }
    const amount=cash.get(a.id)??0;
    output.push({account:a.id,accountName:a.name,network:identity.network,exchange:identity.exchange,
      asset:identity.quote,quote:identity.quote,qty:amount,price:1,value:amount,
      priceDate:new Date(end).toISOString(),priceSource:'Rekonstruierter Cash-Stand aus Trades',cash:true});
  }
  const isCurrent=end>=Date.now();
  const cashChecks=accounts.map((a:TaxAccount)=>{
    const expected=cash.get(a.id)??0,actual=isCurrent?a.cash:null,difference=actual===null?null:expected-actual;
    return {account:a.id,expected,actual,difference,reconciled:difference===null?null:Math.abs(difference)<=1e-6};
  });
  return {holdings:output,cashChecks};
}
