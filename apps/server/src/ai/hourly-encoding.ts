import {compressRootFeatures,readPackedRootFeature} from './feature-encoding.js';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const FORMAT='hourly-trend-dictionary-v1';
/** Exact dictionary sharing, only when it saves bytes. Shared records are not independent observations. */
export function compressHourlyTrends(value:unknown){
 if(!object(value)||!object(value.transmission)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return false;
 const records:Record<string,unknown>[]=[],indices=new Map<string,number>(),updates:{regime:Record<string,unknown>;index:number}[]=[];
 let before=0,after=0;
 for(const market of value.marketContext.markets){
  if(!object(market)||!object(market.regime)||!object(market.regime.hourlyTrend))continue;
  const trend=market.regime.hourlyTrend;if(Object.hasOwn(trend,'hourlyTrendRef')||Object.hasOwn(trend,'hourlyFieldSet'))throw Error('Expand hourly trend references before compression');
  const key=JSON.stringify(trend);let index=indices.get(key);
  if(index===undefined){index=records.length;indices.set(key,index);records.push(trend);}
  updates.push({regime:market.regime,index});before+=key.length;after+=JSON.stringify({hourlyTrendRef:index}).length;
 }
 const metadata={format:FORMAT,records,meaning:'hourlyTrendRef indexes records; all original fields and values retained. Shared records are not independent observations.'};
 if(!updates.length)return false;
 if(after+JSON.stringify(metadata).length+40>=before){
  const table:{features:unknown[];transmission:Record<string,unknown>}={features:updates.map(u=>u.regime.hourlyTrend),transmission:{}};
  if(!compressRootFeatures(table))return false;
  value.transmission.hourlyTrendTableEncoding={...(table.transmission.featureTableEncoding as Record<string,unknown>),format:'market-hourly-columns-v1',meaning:'Each hourlyTrend maps values to fieldSets[hourlyFieldSet]. All original fields/presence/values remain, including unknowns and source clocks. Shared fields do not create independent evidence.'};
  updates.forEach((u,i)=>{const row=table.features[i] as Record<string,unknown>;u.regime.hourlyTrend=Object.hasOwn(row,'featureFieldSet')?{hourlyFieldSet:row.featureFieldSet,values:row.values}:row;});return true;
 }
 for(const {regime,index} of updates)regime.hourlyTrend={hourlyTrendRef:index};
 value.transmission.hourlyTrendTableEncoding=metadata;return true;
}
export function readPackedHourlyTrend(value:unknown,context:unknown):unknown{
 if(object(value)&&Object.hasOwn(value,'hourlyFieldSet')){
  if(Object.keys(value).length!==2||!Object.hasOwn(value,'values')||!object(context)||!object(context.transmission)||!object(context.transmission.hourlyTrendTableEncoding)||context.transmission.hourlyTrendTableEncoding.format!=='market-hourly-columns-v1')throw Error('Invalid packed hourly columns');
  return readPackedRootFeature({featureFieldSet:value.hourlyFieldSet,values:value.values},{transmission:{featureTableEncoding:{...context.transmission.hourlyTrendTableEncoding,format:'root-feature-columns-v1'}}});
 }
 if(!object(value)||!Object.hasOwn(value,'hourlyTrendRef'))return value;
 if(Object.keys(value).length!==1||!Number.isSafeInteger(value.hourlyTrendRef)||Number(value.hourlyTrendRef)<0||!object(context)||!object(context.transmission)||!object(context.transmission.hourlyTrendTableEncoding))throw Error('Invalid packed hourly trend');
 const meta=context.transmission.hourlyTrendTableEncoding,index=Number(value.hourlyTrendRef);
 if(meta.format!==FORMAT||!Array.isArray(meta.records)||!object(meta.records[index])||Object.hasOwn(meta.records[index],'hourlyTrendRef'))throw Error('Invalid packed hourly trend');
 return JSON.parse(JSON.stringify(meta.records[index]));
}
export function expandPackedHourlyTrends(value:unknown){
 if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return;
 for(const market of value.marketContext.markets)if(object(market)&&object(market.regime)&&Object.hasOwn(market.regime,'hourlyTrend'))market.regime.hourlyTrend=readPackedHourlyTrend(market.regime.hourlyTrend,value);
}
