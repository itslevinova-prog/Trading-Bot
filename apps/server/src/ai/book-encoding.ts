const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function microstructures(value:unknown){if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return [];return value.marketContext.markets.flatMap(m=>object(m)&&object(m.microstructure)?[m.microstructure]:[]);}
/** Lossless wire labels only: decimal strings and level order are never converted or rounded. */
export function compressBookLevels(value:unknown){if(!object(value)||!object(value.transmission))return false;const updates:{parent:Record<string,unknown>;key:string;before:unknown;after:unknown}[]=[];
 for(const parent of microstructures(value))for(const key of ['bids','asks']){const levels=parent[key];if(!Array.isArray(levels)||!levels.length||!levels.every(l=>object(l)&&Object.keys(l).length===2&&typeof l.price==='string'&&typeof l.qty==='string'))continue;updates.push({parent,key,before:levels,after:{priceQtyRows:levels.map(l=>[(l as Record<string,unknown>).price,(l as Record<string,unknown>).qty])}});}
 const metadata={format:'price-qty-rows-v1',columns:['price','qty'],meaning:'A book side with priceQtyRows maps each row to the named columns in original level order. All original decimal strings are retained.',records:updates.length};
 if(!updates.length||updates.reduce((n,u)=>n+JSON.stringify(u.before).length-JSON.stringify(u.after).length,0)<=JSON.stringify(metadata).length+32)return false;
 for(const u of updates)u.parent[u.key]=u.after;value.transmission.bookLevelEncoding=metadata;return true;
}
export function readPackedBookLevels(value:unknown,context:unknown):unknown{
 if(!object(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'priceQtyRows'))return value;
 if(!object(context)||!object(context.transmission)||!object(context.transmission.bookLevelEncoding)||context.transmission.bookLevelEncoding.format!=='price-qty-rows-v1'||JSON.stringify(context.transmission.bookLevelEncoding.columns)!=='["price","qty"]'||!Array.isArray(value.priceQtyRows)||!value.priceQtyRows.every(r=>Array.isArray(r)&&r.length===2&&r.every(v=>typeof v==='string')))throw Error('Invalid packed book levels');
 return value.priceQtyRows.map(r=>({price:(r as string[])[0],qty:(r as string[])[1]}));
}
export function expandPackedBookLevels(value:unknown){for(const parent of microstructures(value))for(const key of ['bids','asks'])if(Object.hasOwn(parent,key))parent[key]=readPackedBookLevels(parent[key],value);}
