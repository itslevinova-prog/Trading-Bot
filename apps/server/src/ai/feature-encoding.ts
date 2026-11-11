const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const identity=(v:Record<string,unknown>)=>JSON.stringify(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)));
/** Point exact duplicate market features at the unchanged root feature array. No indicator is removed. */
export function shareDuplicateFeatures(value:unknown){if(!object(value)||!Array.isArray(value.features)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets)||!object(value.transmission))return false;const indices=new Map<string,number>();value.features.forEach((f,i)=>{if(object(f))indices.set(identity(f),i);});const updates:{market:Record<string,unknown>;before:unknown;after:unknown}[]=[];
 for(const m of value.marketContext.markets){if(!object(m)||!object(m.feature))continue;const index=indices.get(identity(m.feature));if(index!==undefined)updates.push({market:m,before:m.feature,after:{rootFeatureIndex:index}});}
 const metadata={format:'root-feature-index-v1',meaning:'A market feature with rootFeatureIndex has every original field and value in features[rootFeatureIndex]. The root features array is unchanged.',references:updates.length};if(!updates.length||updates.reduce((n,u)=>n+JSON.stringify(u.before).length-JSON.stringify(u.after).length,0)<=JSON.stringify(metadata).length+32)return false;
 for(const u of updates)u.market.feature=u.after;value.transmission.featureReferences=metadata;return true;
}
export function readPackedFeature(value:unknown,context:unknown){if(!object(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'rootFeatureIndex'))return value;if(!object(context)||!object(context.transmission)||!object(context.transmission.featureReferences)||context.transmission.featureReferences.format!=='root-feature-index-v1'||!Array.isArray(context.features)||!Number.isSafeInteger(value.rootFeatureIndex)||Number(value.rootFeatureIndex)<0||!object(context.features[Number(value.rootFeatureIndex)]))throw Error('Invalid packed feature reference');return readPackedRootFeature(context.features[Number(value.rootFeatureIndex)],context);}
export function expandPackedFeatureReferences(value:unknown){if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return;for(const m of value.marketContext.markets)if(object(m))m.feature=readPackedFeature(m.feature,value);}

/** Lossless root-column sharing; indices and every original indicator/value remain intact. */
export function compressRootFeatures(value:unknown){if(!object(value)||!Array.isArray(value.features)||!object(value.transmission))return false;
 const fields:string[][]=[],indices=new Map<string,number>(),updates=new Map<number,unknown>();let before=0,after=0;
 value.features.forEach((feature,i)=>{if(!object(feature))return;const keys=Object.keys(feature).sort();if(keys.length>64||!keys.length)return;const signature=JSON.stringify(keys);let index=indices.get(signature);if(index===undefined){index=fields.length;indices.set(signature,index);fields.push(keys);}const encoded={featureFieldSet:index,values:keys.map(k=>feature[k])};updates.set(i,encoded);before+=JSON.stringify(feature).length;after+=JSON.stringify(encoded).length;});
 const metadata={format:'root-feature-columns-v1',fieldSets:fields,records:updates.size,meaning:'Each root features record with featureFieldSet and values maps values in order to its named fieldSet. All original keys, field presence and values are retained. Market rootFeatureIndex points at the decoded root record with the same index.'};
 if(!updates.size||after+JSON.stringify(metadata).length+40>=before)return false;value.features=value.features.map((f,i)=>updates.get(i)??f);value.transmission.featureTableEncoding=metadata;
 if(object(value.transmission.featureReferences))value.transmission.featureReferences.meaning='A market rootFeatureIndex points at the root feature record with that index. Decode a tabulated root record using featureTableEncoding; every original feature field/value is retained.';
 return true;
}
export function readPackedRootFeature(value:unknown,context:unknown):unknown{
 if(!object(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'featureFieldSet')||!Object.hasOwn(value,'values'))return value;
 if(!object(context)||!object(context.transmission)||!object(context.transmission.featureTableEncoding)||context.transmission.featureTableEncoding.format!=='root-feature-columns-v1'||!Array.isArray(context.transmission.featureTableEncoding.fieldSets)||!Number.isSafeInteger(value.featureFieldSet)||Number(value.featureFieldSet)<0||!Array.isArray(value.values))throw Error('Invalid packed root feature');
 const keys=context.transmission.featureTableEncoding.fieldSets[Number(value.featureFieldSet)] as unknown;if(!Array.isArray(keys)||keys.length>64||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length||keys.length!==value.values.length)throw Error('Invalid packed root feature fields');return Object.fromEntries(keys.map((k,i)=>[k,(value.values as unknown[])[i]]));
}
export function expandPackedRootFeatures(value:unknown){if(!object(value)||!Array.isArray(value.features))return;value.features=value.features.map(f=>readPackedRootFeature(f,value));}


/** Reuse the exact feature-column codec for per-market structure without dropping any fields. */
export function compressMarketStructures(value:unknown){
 if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets)||!object(value.transmission))return false;
 const markets=value.marketContext.markets.filter(m=>object(m)&&object(m.regime)&&object(m.regime.structure));
 const table:{features:unknown[];transmission:Record<string,unknown>}={features:markets.map(m=>m.regime.structure),transmission:{}};
 if(!compressRootFeatures(table))return false;
 const meta=table.transmission.featureTableEncoding as Record<string,unknown>;
 value.transmission.structureTableEncoding={...meta,format:'market-structure-columns-v1',meaning:'Each regime.structure record maps values to fieldSets[structureFieldSet]; every original field, presence and value is retained. Observed structure is not a probability.'};
 markets.forEach((m,i)=>{const row=table.features[i] as {featureFieldSet:number;values:unknown[]};m.regime.structure={structureFieldSet:row.featureFieldSet,values:row.values};});return true;
}
export function readPackedMarketStructure(value:unknown,context:unknown):unknown{
 if(!object(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'structureFieldSet')||!Object.hasOwn(value,'values'))return value;
 if(!object(context)||!object(context.transmission)||!object(context.transmission.structureTableEncoding)||context.transmission.structureTableEncoding.format!=='market-structure-columns-v1')throw Error('Invalid packed market structure');
 return readPackedRootFeature({featureFieldSet:value.structureFieldSet,values:value.values},{transmission:{featureTableEncoding:{...context.transmission.structureTableEncoding,format:'root-feature-columns-v1'}}});
}
export function expandPackedMarketStructures(value:unknown){if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return;for(const m of value.marketContext.markets)if(object(m)&&object(m.regime))m.regime.structure=readPackedMarketStructure(m.regime.structure,value);}

/** Share the complete regime field set; nested evidence is retained with its own labelled encoding. */
export function compressMarketRegimes(value:unknown){
 if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets)||!object(value.transmission))return false;
 const markets=value.marketContext.markets.filter(m=>object(m)&&object(m.regime));
 const table:{features:unknown[];transmission:Record<string,unknown>}={features:markets.map(m=>m.regime),transmission:{}};
 if(!compressRootFeatures(table))return false;
 value.transmission.regimeTableEncoding={...(table.transmission.featureTableEncoding as Record<string,unknown>),format:'market-regime-columns-v1',meaning:'Each regime maps values to fieldSets[regimeFieldSet]; every original field/value remains. Decode the regime before nested structure/hourly evidence using their labelled metadata. No independent votes or probabilities inferred.'};
 markets.forEach((m,i)=>{const row=table.features[i] as Record<string,unknown>;m.regime=Object.hasOwn(row,'featureFieldSet')?{regimeFieldSet:row.featureFieldSet,values:row.values}:row;});return true;
}
export function readPackedMarketRegime(value:unknown,context:unknown):unknown{
 if(!object(value)||!Object.hasOwn(value,'regimeFieldSet'))return value;
 if(Object.keys(value).length!==2||!Object.hasOwn(value,'values')||!object(context)||!object(context.transmission)||!object(context.transmission.regimeTableEncoding)||context.transmission.regimeTableEncoding.format!=='market-regime-columns-v1')throw Error('Invalid packed market regime');
 return readPackedRootFeature({featureFieldSet:value.regimeFieldSet,values:value.values},{transmission:{featureTableEncoding:{...context.transmission.regimeTableEncoding,format:'root-feature-columns-v1'}}});
}
export function expandPackedMarketRegimes(value:unknown){if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return;for(const m of value.marketContext.markets)if(object(m)&&Object.hasOwn(m,'regime'))m.regime=readPackedMarketRegime(m.regime,value);}

/** Reuse the existing lossless column codec for annotated ticker-quality records. */
export function compressMarketQuality(value:unknown){
 if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets)||!object(value.transmission))return false;
 const markets=value.marketContext.markets.filter(m=>object(m)&&object(m.quality));
 if(!markets.some(m=>object(m.ticker)&&Object.hasOwn(m.ticker,'fieldReceivedAt')))return false;
 const table:{features:unknown[];transmission:Record<string,unknown>}={features:markets.map(m=>m.quality),transmission:{}};
 if(!compressRootFeatures(table))return false;
 value.transmission.qualityTableEncoding={...(table.transmission.featureTableEncoding as Record<string,unknown>),format:'market-quality-columns-v1',meaning:'Each quality record maps values to fieldSets[qualityFieldSet]. All original fields are retained. Ticker fieldReceivedAt contains separate local receipt clocks; null clocks are unknown, never fresh.'};
 markets.forEach((m,i)=>{const row=table.features[i] as Record<string,unknown>;m.quality=Object.hasOwn(row,'featureFieldSet')?{qualityFieldSet:row.featureFieldSet,values:row.values}:row;});return true;
}
export function readPackedMarketQuality(value:unknown,context:unknown):unknown{
 if(!object(value)||!Object.hasOwn(value,'qualityFieldSet'))return value;
 if(Object.keys(value).length!==2||!Object.hasOwn(value,'values')||!object(context)||!object(context.transmission)||!object(context.transmission.qualityTableEncoding)||context.transmission.qualityTableEncoding.format!=='market-quality-columns-v1')throw Error('Invalid packed market quality');
 return readPackedRootFeature({featureFieldSet:value.qualityFieldSet,values:value.values},{transmission:{featureTableEncoding:{...context.transmission.qualityTableEncoding,format:'root-feature-columns-v1'}}});
}
export function expandPackedMarketQuality(value:unknown){if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return;for(const m of value.marketContext.markets)if(object(m)&&Object.hasOwn(m,'quality'))m.quality=readPackedMarketQuality(m.quality,value);}

/** Reuse the existing lossless column codec for annotated ticker records. */
export function compressMarketTickers(value:unknown){
 if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets)||!object(value.transmission))return false;
 const markets=value.marketContext.markets.filter(m=>object(m)&&object(m.ticker));
 if(!markets.some(m=>object(m.ticker)&&Object.hasOwn(m.ticker,'fieldReceivedAt')))return false;
 const table:{features:unknown[];transmission:Record<string,unknown>}={features:markets.map(m=>m.ticker),transmission:{}};
 if(!compressRootFeatures(table))return false;
 value.transmission.tickerTableEncoding={...(table.transmission.featureTableEncoding as Record<string,unknown>),format:'market-ticker-columns-v1',meaning:'Each ticker record maps values to fieldSets[tickerFieldSet]. All original fields are retained. Ticker fieldReceivedAt contains separate local receipt clocks; null clocks are unknown, never fresh.'};
 markets.forEach((m,i)=>{const row=table.features[i] as Record<string,unknown>;m.ticker=Object.hasOwn(row,'featureFieldSet')?{tickerFieldSet:row.featureFieldSet,values:row.values}:row;});return true;
}
export function readPackedMarketTicker(value:unknown,context:unknown):unknown{
 if(!object(value)||!Object.hasOwn(value,'tickerFieldSet'))return value;
 if(Object.keys(value).length!==2||!Object.hasOwn(value,'values')||!object(context)||!object(context.transmission)||!object(context.transmission.tickerTableEncoding)||context.transmission.tickerTableEncoding.format!=='market-ticker-columns-v1')throw Error('Invalid packed market ticker');
 return readPackedRootFeature({featureFieldSet:value.tickerFieldSet,values:value.values},{transmission:{featureTableEncoding:{...context.transmission.tickerTableEncoding,format:'root-feature-columns-v1'}}});
}
export function expandPackedMarketTickers(value:unknown){if(!object(value)||!object(value.marketContext)||!Array.isArray(value.marketContext.markets))return;for(const m of value.marketContext.markets)if(object(m)&&Object.hasOwn(m,'ticker'))m.ticker=readPackedMarketTicker(m.ticker,value);}
