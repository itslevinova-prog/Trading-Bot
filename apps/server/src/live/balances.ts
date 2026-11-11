import type {BinanceSymbol} from '../market/binance-data.js';
import {addDecimal,compareDecimal,commonStep,floorStep} from './decimal.js';
export type Balance={asset:string;free:string;locked:string};
export function checkedBalances(account:{canTrade:unknown;balances:unknown}):Balance[]{
 if(account.canTrade!==true||!Array.isArray(account.balances))throw Error('Konto nicht für Spot-Handel freigegeben');const seen=new Set<string>();
 return account.balances.map(row=>{if(!row||typeof row.asset!=='string'||!row.asset||row.asset.length>100||/[\u0000-\u001f\u007f/]/.test(row.asset)||seen.has(row.asset)||typeof row.free!=='string'||typeof row.locked!=='string')throw Error('Ungültige oder doppelte Börsensalden');addDecimal(row.free,row.locked);if(![Number(row.free),Number(row.locked)].every(Number.isFinite))throw Error('Ungültiger Börsensaldo');seen.add(row.asset);return {asset:row.asset,free:row.free,locked:row.locked};});
}
function quantityFilters(symbol:BinanceSymbol){const filters=symbol.filters.filter(f=>f.filterType==='LOT_SIZE'||f.filterType==='MARKET_LOT_SIZE');if(!filters.some(f=>f.filterType==='LOT_SIZE'))throw Error('Quantity filters missing');for(const f of filters){if(typeof f.minQty!=='string'||typeof f.maxQty!=='string'||typeof f.stepSize!=='string')throw Error('Incomplete quantity filters');for(const value of [f.minQty,f.maxQty,f.stepSize])compareDecimal(value,'0');if(compareDecimal(f.maxQty,'0')>0&&compareDecimal(f.minQty,f.maxQty)>0)throw Error('Contradictory quantity filters');}return filters;}
export function nativeQuantityStep(symbol:BinanceSymbol){return commonStep(quantityFilters(symbol).map(f=>f.stepSize!));}
export function belowNativeQuantity(qty:string,symbol:BinanceSymbol){
 if(compareDecimal(qty,'0')<=0)return false;const filters=quantityFilters(symbol),step=nativeQuantityStep(symbol),rounded=floorStep(qty,step);
 return compareDecimal(rounded,'0')===0||filters.some(f=>compareDecimal(rounded,f.minQty!)<0);
}
export function nativeQuantityAllowed(qty:string,symbol:BinanceSymbol){return compareDecimal(qty,'0')>0&&quantityFilters(symbol).every(f=>compareDecimal(qty,f.minQty!)>=0&&compareDecimal(qty,f.maxQty!)<=0&&(compareDecimal(f.stepSize!,'0')===0||compareDecimal(qty,floorStep(qty,f.stepSize!))===0));}
function notionalAllowed(qty:number,price:number,symbol:BinanceSymbol,market:boolean){
 if(!Number.isFinite(qty)||!Number.isFinite(price)||qty<=0||price<=0)return false;const value=qty*price;if(!Number.isFinite(value))return false;
 for(const filter of symbol.filters.filter(f=>f.filterType==='MIN_NOTIONAL'||f.filterType==='NOTIONAL')){
  const min=Number(filter.minNotional);if(!Number.isFinite(min)||min<0)throw Error('Invalid notional filter');const minimumApplies=!market||(filter.filterType==='MIN_NOTIONAL'?filter.applyToMarket!==false:filter.applyMinToMarket!==false);if(minimumApplies&&value<min)return false;
  if(filter.maxNotional!==undefined){const max=Number(filter.maxNotional);if(!Number.isFinite(max)||max<=0)throw Error('Invalid maximum notional');if((!market||filter.applyMaxToMarket!==false)&&value>max)return false;}
 }
 return true;
}

export const nativeNotionalAllowed=(qty:number,price:number,symbol:BinanceSymbol)=>notionalAllowed(qty,price,symbol,true);
export const limitNotionalAllowed=(qty:number,price:number,symbol:BinanceSymbol)=>notionalAllowed(qty,price,symbol,false);

export function limitQuantityAllowed(qty:string,symbol:BinanceSymbol){return compareDecimal(qty,'0')>0&&quantityFilters(symbol).filter(f=>f.filterType==='LOT_SIZE').every(f=>compareDecimal(qty,f.minQty!)>=0&&compareDecimal(qty,f.maxQty!)<=0&&(compareDecimal(f.stepSize!,'0')===0||compareDecimal(qty,floorStep(qty,f.stepSize!))===0));}
