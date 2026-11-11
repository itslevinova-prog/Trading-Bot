import type Database from 'better-sqlite3';

export type TaxMethod = 'fifo' | 'average';
export type TaxCurrency = 'CHF' | 'EUR';
export type TaxIdentity = {exchange:string;quote:string;network:'paper'};
export type TaxAccount = {id:string;name:string;strategy:string;startingBalance:number;cash:number;createdAt:number};
export type TaxTrade = {id:string;accountId:string;pair:string;side:'buy'|'sell';qty:number;fillPrice:number;costEur:number;feeEur:number;realizedPnlEur:number|null;ts:number;reason:string};
export type LedgerEntry = {
  id:string;ts:number;event:'deposit'|'trade';account:string;accountName:string;network:string;exchange:string;
  pair:string;base:string;quote:string;side:string;qty:number;price:number;gross:number;fee:number;feeCurrency:string;
  tradeId:string;strategy:string;reason:string;cashDelta:number;
};

export function assertSingleNetwork(networks:Iterable<string>):void {
  if(new Set(networks).size>1)throw Error('Netzwerk-Mischung im Steuer-Export verboten');
}

export function readIdentity(db:Database.Database):TaxIdentity {
  const row=db.prepare('SELECT venue_quote FROM database_identity WHERE id=1').get() as {venue_quote:string}|undefined;
  if(!row)throw Error('Fehlende Datenbank-Identität: Export abgebrochen');
  const parts=row.venue_quote.split(':');
  if(parts.length!==2||!parts[0]||!parts[1])throw Error('Ungültige Datenbank-Identität');
  return {exchange:parts[0]!,quote:parts[1]!,network:'paper'};
}
export function loadAccounts(db:Database.Database,accountId?:string):TaxAccount[] {
  const rows=db.prepare('SELECT id,name,strategy,starting_balance AS startingBalance,cash,created_at AS createdAt FROM accounts'+(accountId?' WHERE id=?':'')+' ORDER BY id').all(...(accountId?[accountId]:[])) as TaxAccount[];
  if(accountId&&!rows.length)throw Error('Unbekanntes Konto: '+accountId);
  return rows;
}
export function loadTrades(db:Database.Database,options:{accountId?:string;to:number}):TaxTrade[] {
  const rows=db.prepare('SELECT id,account_id AS accountId,pair,side,qty,fill_price AS fillPrice,cost_eur AS costEur,fee_eur AS feeEur,realized_pnl_eur AS realizedPnlEur,ts,reason FROM trades WHERE ts<=?'+(options.accountId?' AND account_id=?':'')+' ORDER BY ts,id').all(options.to,...(options.accountId?[options.accountId]:[])) as TaxTrade[];
  for(const t of rows)if(t.side!=='buy'&&t.side!=='sell')throw Error('Unbekannte Trade-Richtung: '+t.id);
  return rows;
}
export function buildLedger(db:Database.Database,options:{accountId?:string;from:number;to:number}):LedgerEntry[] {
  if(!Number.isFinite(options.from)||!Number.isFinite(options.to)||options.from>options.to)throw Error('Ungültiger Export-Zeitraum');
  const identity=readIdentity(db),accts=loadAccounts(db,options.accountId),byId=new Map(accts.map(a=>[a.id,a]));
  const result:LedgerEntry[]=[];
  for(const a of accts)if(a.createdAt>=options.from&&a.createdAt<=options.to)result.push({
    id:a.id+':opening',ts:a.createdAt,event:'deposit',account:a.id,accountName:a.name,
    network:identity.network,exchange:identity.exchange,pair:'',base:'',quote:identity.quote,side:'deposit',
    qty:0,price:0,gross:a.startingBalance,fee:0,feeCurrency:identity.quote,tradeId:'',strategy:a.strategy,
    reason:'Einzahlung (simuliert)',cashDelta:a.startingBalance
  });
  for(const t of loadTrades(db,{accountId:options.accountId,to:options.to})){
    if(t.ts<options.from)continue;
    const a=byId.get(t.accountId);if(!a)throw Error('Trade ohne Konto: '+t.id);
    const [base,quote,...rest]=t.pair.split('/');
    if(!base||!quote||rest.length||quote!==identity.quote)throw Error('Trade passt nicht zur Datenbank-Quote: '+t.id);
    result.push({id:t.id,ts:t.ts,event:'trade',account:a.id,accountName:a.name,network:identity.network,
      exchange:identity.exchange,pair:t.pair,base,quote,side:t.side,qty:t.qty,price:t.fillPrice,gross:t.costEur,
      fee:t.feeEur,feeCurrency:quote,tradeId:t.id,strategy:a.strategy,reason:t.reason,
      cashDelta:t.side==='buy'?-(t.costEur+t.feeEur):t.costEur-t.feeEur});
  }
  assertSingleNetwork(result.map(r=>r.network));
  return result.sort((a,b)=>a.ts-b.ts||a.id.localeCompare(b.id,'en'));
}
