/** Exchange decimal strings remain exact until the final numeric fill boundary. */
export type LotRule={stepSize:string;minQty:string;minNotional:string};
export type LotRules=Record<string,LotRule>;
function fraction(value:string):[bigint,bigint]{
 if(!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))throw Error('Invalid lot decimal');
 const [mantissa,exponent='0']=value.toLowerCase().split('e'),parts=mantissa!.split('.');
 const scale=(parts[1]?.length??0)-Number(exponent);
 if(Math.abs(scale)>100)throw Error('Lot decimal out of range');
 const n=BigInt(parts.join(''));
 return scale>=0?[n,10n**BigInt(scale)]:[n*10n**BigInt(-scale),1n];
}
export function validateRule(rule:LotRule){
 for(const value of [rule.stepSize,rule.minQty,rule.minNotional]){
  if(!/^\d+(?:\.\d+)?$/.test(value))throw Error('Exchange lot rules require fixed decimal strings');
  fraction(value);if(!Number.isFinite(Number(value))||Number(value)<=0)throw Error('Invalid positive lot rule');
 }
 // The unchanged planner supports up to eight decimal places.
 if(lotDecimals(rule)>8)throw Error('Unsupported exchange lot precision');
}
export function lotDecimals(rule:LotRule){return rule.stepSize.replace(/0+$/,'').split('.')[1]?.length??0;}
export function floorLot(quantity:number,rule:LotRule):number{
 if(!Number.isFinite(quantity)||quantity<=0)return 0;
 const [n,d]=fraction(quantity.toString()),[sn,sd]=fraction(rule.stepSize);
 const units=n*sd/(d*sn);
 return Number(units*sn)/Number(sd);
}
export function configLots(rules:LotRules):LotRules{
 const result:LotRules={};
 for(const symbol of Object.keys(rules).sort()){
  const rule=rules[symbol]!;validateRule(rule);
  result[symbol]={stepSize:rule.stepSize,minQty:rule.minQty,minNotional:rule.minNotional};
 }
 if(!result.BTCUSDT||!result.ETHUSDT)throw Error('BTC/ETH exchange lot rules required');
 return result;
}
export type ExchangeInfo={symbols:{symbol:string;quoteAsset:string;status:string;isSpotTradingAllowed:boolean;
 filters:{filterType:string;stepSize?:string;minQty?:string;minNotional?:string}[]}[]};
export function exchangeLots(exchange:ExchangeInfo):LotRules{
 const rules:LotRules={};
 for(const symbol of exchange.symbols){
  if(symbol.quoteAsset!=='USDT'||symbol.status!=='TRADING'||!symbol.isSpotTradingAllowed)continue;
  const lot=symbol.filters.find(f=>f.filterType==='LOT_SIZE');
  const notionals=symbol.filters.filter(f=>f.filterType==='MIN_NOTIONAL'||f.filterType==='NOTIONAL');
  if(!lot?.stepSize||!lot.minQty||!notionals.length||notionals.some(f=>!f.minNotional))throw Error('Missing exchange lot filters: '+symbol.symbol);
  const minNotional=notionals.map(f=>f.minNotional!).sort((a,b)=>Number(b)-Number(a))[0]!;
  const rule={stepSize:lot.stepSize,minQty:lot.minQty,minNotional};validateRule(rule);
  rules[symbol.symbol]=rule;
 }
 return configLots(rules);
}
