type ObjectValue=Record<string,unknown>;
const object=(v:unknown):v is ObjectValue=>!!v&&typeof v==='object'&&!Array.isArray(v);
export type HistoryRepairEncoding={format:'shared-column-order-v1';meaning:string;fieldSets:string[][];records:number};
/** Lossless label sharing for repeated native reports. Every original key, presence and value remains. */
export function compressNativeHistoryRepairs(value:unknown){
 if(!object(value)||!object(value.transmission)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return false;
 const fieldSets:string[][]=[],sets=new Map<string,number>(),updates:{parent:ObjectValue;key:string;before:unknown;after:unknown}[]=[];
 for(const m of value.marketContext.markets){if(!object(m)||!object(m.historyRepair))continue;for(const key of ['m15','h1']){const r=m.historyRepair[key];if(!object(r)||r.exchangeDataAttested!==false||typeof r.localIntegrityChecked!=='boolean'||r.days!==90||!['live','testnet'].includes(String(r.network)))continue;const fields=Object.keys(r).sort();if(fields.length>64)continue;const id=JSON.stringify(fields);let index=sets.get(id);if(index===undefined){index=fieldSets.length;sets.set(id,index);fieldSets.push(fields);}updates.push({parent:m.historyRepair,key,before:r,after:{fieldSet:index,values:fields.map(f=>r[f])}});}}
 if(!updates.length)return false;const encoding:HistoryRepairEncoding={format:'shared-column-order-v1',meaning:'Each report values array maps in order to the named fieldSet. All original keys and values are retained; fields absent from a fieldSet were absent in that original report.',fieldSets,records:updates.length};
 const before=updates.reduce((n,r)=>n+JSON.stringify(r.before).length,0),after=updates.reduce((n,r)=>n+JSON.stringify(r.after).length,0)+JSON.stringify(encoding).length+32;if(after>=before)return false;
 for(const u of updates)u.parent[u.key]=u.after;value.transmission.historyRepairEncoding=encoding;return true;
}
/** Used to verify exact delivery; table metadata is part of the actual model input. */
export function readPackedHistoryReport(value:unknown,encoding:unknown):ObjectValue{
 if(!object(value))throw Error('Invalid history report');if(!Object.hasOwn(value,'fieldSet')||!Object.hasOwn(value,'values'))return value;
 if(!object(encoding)||encoding.format!=='shared-column-order-v1'||!Array.isArray(encoding.fieldSets)||!Number.isSafeInteger(value.fieldSet)||Number(value.fieldSet)<0||!Array.isArray(value.values))throw Error('Invalid packed history report');
 const values=value.values;const fields=encoding.fieldSets[Number(value.fieldSet)] as unknown;if(!Array.isArray(fields)||fields.length>64||fields.some(f=>typeof f!=='string')||new Set(fields).size!==fields.length||fields.length!==values.length)throw Error('Invalid packed history field set');return Object.fromEntries(fields.map((f,i)=>[f,values[i]]));
}

export function expandPackedHistoryRepairs(value:unknown){if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return;const encoding=object(value.transmission)?value.transmission.historyRepairEncoding:undefined;for(const m of value.marketContext.markets){if(!object(m)||!object(m.historyRepair))continue;for(const key of ['m15','h1']){const r=m.historyRepair[key];if(object(r)&&Object.keys(r).length===2&&Object.hasOwn(r,'fieldSet')&&Object.hasOwn(r,'values'))m.historyRepair[key]=readPackedHistoryReport(r,encoding);}}}
