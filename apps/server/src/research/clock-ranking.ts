export type ClockForecast={pair:string;decisionAt:number;forecast:number|null};
/** Score-only ranking. This function cannot inspect outcomes, choose risk or authorize a trade. */
export function rankClockForecasts(rows:readonly ClockForecast[],margin=.005){
 if(!Array.isArray(rows)||!Number.isFinite(margin)||margin<0||margin>1)throw Error('Invalid ranking scope');
 const groups=new Map<number,ClockForecast[]>(),seen=new Set<string>();
 for(const r of rows){if(!r||typeof r.pair!=='string'||!r.pair.trim()||!Number.isSafeInteger(r.decisionAt)||r.decisionAt<0||r.forecast!==null&&!Number.isFinite(r.forecast))throw Error('Invalid clock forecast');const key=JSON.stringify([r.decisionAt,r.pair]);if(seen.has(key))throw Error('Duplicate pair/clock forecast');seen.add(key);const group=groups.get(r.decisionAt)??[];group.push({...r});groups.set(r.decisionAt,group);}
 return [...groups].sort(([a],[b])=>a-b).map(([decisionAt,rs])=>{const candidates=rs.filter((r):r is ClockForecast&{forecast:number}=>r.forecast!==null&&r.forecast>margin).sort((a,b)=>b.forecast-a.forecast||a.pair.localeCompare(b.pair));return {decisionAt,universeRows:rs.length,abstentions:rs.filter(r=>r.forecast===null).length,aboveMarginRows:candidates.length,winner:candidates[0]?{pair:candidates[0].pair,forecast:candidates[0].forecast}:null};});
}
