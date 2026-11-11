import type Database from 'better-sqlite3';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {buildLedger,loadAccounts,loadTrades,readIdentity} from './ledger.js';
import type {TaxMethod,TaxCurrency} from './ledger.js';
import {buildHoldings,yearStart,yearEnd} from './holdings.js';
import {convertFx,dateInZurich,loadEcbRates} from './fx.js';
import type {FxTable} from './fx.js';
export type ExportOptions = {year:number;currency:TaxCurrency;method:TaxMethod;accountId?:string;delimiter?:string;root:string;fxRates?:FxTable;allowDownload?:boolean};
export type ExportFile = {name:string;content:Buffer};
export type TaxReport = {folder:string;files:ExportFile[];summary:Record<string,unknown>};

export function csv(headers:string[],rows:Record<string,unknown>[],delimiter=';'):Buffer {
  if(delimiter!==';'&&delimiter!==','&&delimiter!=='\t')throw Error('Trennzeichen muss ;, Komma oder Tab sein');
  const cell=(value:unknown)=>{
    if(value===null||value===undefined)return '';
    let s=typeof value==='number'?String(value):String(value);
    // Prevent spreadsheet formula execution in untrusted free-text columns.
    if(/^[=+\-@\t\r]/.test(s)&&typeof value==='string')s="'"+s;
    return /["\r\n]/.test(s)||s.includes(delimiter)?'"'+s.replace(/"/g,'""')+'"':s;
  };
  const text=[headers.join(delimiter),...rows.map(row=>headers.map(h=>cell(row[h])).join(delimiter))].join('\r\n')+'\r\n';
  return Buffer.from('\uFEFF'+text,'utf8');
}
const iso=(ts:number)=>new Date(ts).toISOString();
const identityNote='Paper-Daten (Spielgeld), keine Steuerberatung';
export async function buildTaxExport(db:Database.Database,options:ExportOptions):Promise<TaxReport> {
  const {year,currency,method,accountId,root}=options;
  if(!Number.isInteger(year)||year<2000||year>2100)throw Error('Ungültiges Steuerjahr');
  if(currency!=='CHF'&&currency!=='EUR')throw Error('Zielwährung muss CHF oder EUR sein');
  if(method!=='fifo'&&method!=='average')throw Error('Kostenbasis-Methode muss fifo oder average sein');
  if(accountId&&!/^[a-zA-Z0-9_-]{1,80}$/.test(accountId))throw Error('Ungültige Konto-ID für Exportpfad');
  const delimiter=options.delimiter??';';
  const identity=readIdentity(db);
  const accounts=loadAccounts(db,accountId).filter(a=>a.createdAt<=yearEnd(year));
  const from=yearStart(year),to=yearEnd(year);
  const ledger=buildLedger(db,{accountId,from,to});
  const allTrades=loadTrades(db,{accountId,to});
  const {calculateGains}=await import('./lots.js');
  const gains=calculateGains(allTrades,method).filter(g=>g.ts>=from&&g.ts<=to);
  const {holdings,cashChecks}=buildHoldings(db,year,accountId);
  const needsFx=identity.quote!==currency&&(identity.quote==='USDT'||identity.quote==='USDC'||identity.quote==='USD'||identity.quote==='CHF'||identity.quote==='EUR');
  if(identity.quote!==currency&&!needsFx)throw Error('EZB unterstützt Quote-Währung nicht: '+identity.quote);
  const rates=options.fxRates??(needsFx?await loadEcbRates(root,options.allowDownload??true):new Map());
  const convert=(amount:number,quote:string,ts:number)=>convertFx(rates,amount,quote,currency,dateInZurich(ts));
  const tradeRows=ledger.map(e=>{
    const fx=convert(e.gross,e.quote,e.ts);
    return {ts:iso(e.ts),event:e.event,account:e.account,accountName:e.accountName,network:e.network,
      exchange:e.exchange,pair:e.pair,base:e.base,quote:e.quote,side:e.side,qty:e.qty,price:e.price,
      gross:e.gross,fee:e.fee,feeCurrency:e.feeCurrency,netCashDelta:e.cashDelta,
      grossConverted:fx.amount,feeConverted:e.fee*fx.fxRate,netCashDeltaConverted:e.cashDelta*fx.fxRate,
      targetCurrency:currency,fxRate:fx.fxRate,fxDate:fx.fxDate,fxSource:fx.fxSource,
      fxNote:fx.fxNote,tradeId:e.tradeId,strategy:e.strategy,reason:e.reason,disclaimer:identityNote};
  });
  const gainRows=gains.map(g=>{
    const fx=convert(g.gain,identity.quote,g.ts);
    return {ts:iso(g.ts),sellTradeId:g.sellTradeId,account:g.accountId,network:identity.network,exchange:identity.exchange,
      pair:g.pair,quote:identity.quote,qty:g.qty,method,proceeds:g.proceeds,costBasis:g.costBasis,
      gain:g.gain,gainConverted:fx.amount,targetCurrency:currency,holdingDays:g.holdingDays,
      lotsUsed:JSON.stringify(g.lotsUsed),storedPnl:g.storedPnl,ledgerDifference:g.difference,
      pnlReconciled:g.reconciled,fxRate:fx.fxRate,fxDate:fx.fxDate,fxSource:fx.fxSource,fxNote:fx.fxNote,disclaimer:identityNote};
  });
  const holdingRows=holdings.map(h=>{
    const fx=h.value===null?null:convert(h.value,h.quote,to);
    return {asOf:iso(to),account:h.account,accountName:h.accountName,network:h.network,exchange:h.exchange,
      asset:h.asset,quote:h.quote,isCash:h.cash,qty:h.qty,price:h.price,value:h.value,
      priceDate:h.priceDate,priceSource:h.priceSource,valueConverted:fx?.amount??null,targetCurrency:currency,
      fxRate:fx?.fxRate??null,fxDate:fx?.fxDate??'',fxSource:fx?.fxSource??'',
      fxNote:fx?.fxNote??'Kursbewertung fehlt',disclaimer:identityNote};
  });
  const unmatched=gains.filter(g=>!g.reconciled);
  const warnings:string[]=[];
  if(unmatched.length)warnings.push(unmatched.length+' Verkäufe weichen von gespeichertem realizedPnlEur ab; FIFO und bisherige Broker-Durchschnittskostenbasis können unterschiedlich sein.');
  if(cashChecks.some(c=>c.reconciled===false))warnings.push('Cash-Abweichungen zwischen Journal und Konto vorhanden (u. a. Rundung, spätere Bewegungen oder gekappter Paper-Cash möglich).');
  if(holdings.some(h=>h.value===null))warnings.push('Mindestens ein Jahresendbestand konnte mangels geschlossener Kerze nicht bewertet werden.');
  if(to>Date.now())warnings.push('Steuerjahr noch nicht abgeschlossen: Jahresendbewertung ist vorläufig.');
  const weightedQty=gains.reduce((s,g)=>s+g.qty,0);
  const summary:Record<string,unknown>={
    year,asOf:iso(to),accountId:accountId??'all',accounts:accounts.map(a=>a.id),network:identity.network,
    exchange:identity.exchange,quote:identity.quote,currency,method,
    trades:ledger.filter(e=>e.event==='trade').length,ledgerEntries:ledger.length,
    turnover:ledger.filter(e=>e.event==='trade').reduce((s,e)=>s+e.gross,0),
    turnoverConverted:tradeRows.filter(r=>r.event==='trade').reduce((s,r)=>s+r.grossConverted,0),
    fees:ledger.reduce((s,e)=>s+e.fee,0),feesConverted:tradeRows.reduce((s,r)=>s+r.feeConverted,0),
    realizedGain:gains.reduce((s,g)=>s+g.gain,0),realizedGainConverted:gainRows.reduce((s,g)=>s+g.gainConverted,0),
    averageHoldingDays:weightedQty?gains.reduce((s,g)=>s+g.holdingDays*g.qty,0)/weightedQty:null,
    pnlReconciliation:{checked:gains.length,matched:gains.length-unmatched.length,mismatches:unmatched.map(g=>({sellTradeId:g.sellTradeId,difference:g.difference,storedPnl:g.storedPnl,calculated:g.gain}))},
    cashReconciliation:cashChecks,allChecksGreen:unmatched.length===0&&cashChecks.every(c=>c.reconciled!==false),
    cashMovementFromTrades:accounts.map(a=>({account:a.id,delta:ledger.filter(e=>e.event==='trade'&&e.account===a.id).reduce((s,e)=>s+e.cashDelta,0)})),
    warnings,disclaimer:identityNote,
    assumptions:['USDT/USDC als USD (1:1) angenähert','Paper-Käufe und Verkäufe, keine echten Steuervorgänge','Gleicher EZB-Tageskurs für alle Tagesgeschäfte, davorliegender Kurs am Wochenende/Feiertag','Kostenbasis: '+method]
  };
  const files:ExportFile[]=[
    {name:'trades.csv',content:csv(['ts','event','account','accountName','network','exchange','pair','base','quote','side','qty','price','gross','fee','feeCurrency','netCashDelta','grossConverted','feeConverted','netCashDeltaConverted','targetCurrency','fxRate','fxDate','fxSource','fxNote','tradeId','strategy','reason','disclaimer'],tradeRows,delimiter)},
    {name:'realized-gains.csv',content:csv(['ts','sellTradeId','account','network','exchange','pair','quote','qty','method','proceeds','costBasis','gain','gainConverted','targetCurrency','holdingDays','lotsUsed','storedPnl','ledgerDifference','pnlReconciled','fxRate','fxDate','fxSource','fxNote','disclaimer'],gainRows,delimiter)},
    {name:'holdings-'+year+'-12-31.csv',content:csv(['asOf','account','accountName','network','exchange','asset','quote','isCash','qty','price','value','priceDate','priceSource','valueConverted','targetCurrency','fxRate','fxDate','fxSource','fxNote','disclaimer'],holdingRows,delimiter)},
    {name:'summary.json',content:Buffer.from(JSON.stringify(summary,null,2)+'\n')},
    {name:'LIESMICH.txt',content:Buffer.from('KEINE STEUERBERATUNG\n\nDies sind ausschliesslich simulierte Paper-Trades (Spielgeld), keine echten Gewinne oder Vermoegenswerte.\nSteuerjahr: '+year+'\nKostenbasis: '+method+'\nBörse: '+identity.exchange+'\nNetzwerk: '+identity.network+'\nOriginal-Quote: '+identity.quote+'\nZielwährung: '+currency+'\n\nAnnahmen: USDT/USDC werden als USD 1:1 angenähert; EZB-Referenzkurse gelten tagesbezogen, Wochenenden mit letztem älteren Kurs. Candle-Bewertung: letzter vollständiger lokaler Kerzenschluss vor 31.12. 23:59:59 Europe/Zurich. Eine fehlende Kerze bleibt unbewertet.\n\nAbweichungen im FIFO-Abgleich mit der aktuellen durchschnittlichen Broker-Kostenbasis stehen in realized-gains.csv und summary.json. Die Cash-Rekonstruktion erfolgt seit Kontoeröffnung. Historische Kontostände sind nicht direkt mit dem heutigen cash-Feld vergleichbar.\n\nPrüfe die Angaben vor jeder Verwendung selbst.\n','utf8')}
  ];
  if(new Set([...tradeRows,...gainRows,...holdingRows].map(r=>r.network)).size>1)throw Error('Netzwerk-Mischung im Export erkannt');
  const folder='tax-'+year+'-'+(accountId??'all')+'-'+currency+'-'+identity.network;
  return {folder,files,summary};
}
export async function writeTaxExport(report:TaxReport,root:string):Promise<string> {
  const directory=resolve(root,'data/exports',report.folder);
  await mkdir(directory,{recursive:true});
  for(const file of report.files)await writeFile(resolve(directory,file.name),file.content);
  return directory;
}
