import {maxDrawdown,quantile} from './stats.js';

const DAY_MS=86_400_000;
const FIRST_DEV_DAY=Date.UTC(2020,0,1);
const END_DEV_DAY=Date.UTC(2024,0,1);

export type SynchronizedPortfolioDay={
  /** UTC midnight of an observed, completed development day. Never a future mark. */
  utcDayMs:number;
  /** Same-day close-to-close market returns, observed for every symbol. */
  returns:Readonly<Record<string,number|null>>;
  /** Already held, same-quote portfolio fractions; cash is the unallocated remainder. */
  exposures:Readonly<Record<string,number|null>>;
};

export type SynchronizedBootstrapBand={p10:number;p50:number;p90:number};
export type SynchronizedBootstrapReport={
  version:'synchronized-portfolio-bootstrap-v1';
  status:'ok'|'insufficient_evidence';
  reason:string|null;
  days:number;
  symbols:string[];
  seed:number;
  paths:number;
  blockLength:number;
  endReturn:SynchronizedBootstrapBand|null;
  maxDrawdown:SynchronizedBootstrapBand|null;
  worstDailyReturn:SynchronizedBootstrapBand|null;
  maxClusterExposure:SynchronizedBootstrapBand|null;
  /** Auditable first synthetic path: both assets always use each listed source index. */
  firstPathSourceIndices:number[]|null;
  firstPathPortfolioReturns:number[]|null;
  note:string;
};

export type SynchronizedBootstrapOptions={seed?:number;paths?:number;blockLength?:number};

function randomGenerator(seed:number):()=>number {
  let state=(seed>>>0)||0x9e3779b9;
  return ()=>{
    state^=state<<13;
    state^=state>>>17;
    state^=state<<5;
    return (state>>>0)/4294967296;
  };
}
const band=(values:number[]):SynchronizedBootstrapBand=>({
  p10:quantile(values,.1),p50:quantile(values,.5),p90:quantile(values,.9)
});

/**
 * Read-only stationary block bootstrap of JOINT historical daily return vectors.
 * Every source-day index is shared by all assets and their observed positions.
 * This is a scenario diagnostic, not an order model or a return forecast.
 * Incomplete or stale inputs cannot produce numerical performance bands.
 */
export function synchronizedPortfolioBootstrap(
  days:readonly SynchronizedPortfolioDay[],
  clusters:Readonly<Record<string,string>>,
  options:SynchronizedBootstrapOptions={}
):SynchronizedBootstrapReport {
  const seed=options.seed??1,paths=options.paths??1000,blockLength=options.blockLength??10;
  if(!Number.isSafeInteger(seed)||!Number.isInteger(paths)||paths<1||paths>10_000||
    !Number.isFinite(blockLength)||blockLength<1)
    throw Error('Invalid synchronized bootstrap configuration');
  const symbols=Object.keys(days[0]?.returns??{}).sort();
  const note='Rein synthetische, gemeinsame historische Tagesblöcke und bereits bestehende Positionsgewichte; keine Renditeprognose, keine neuen Positionen und keine unabhängige Fill-Evidenz.';
  const base={
    version:'synchronized-portfolio-bootstrap-v1' as const,days:days.length,symbols,
    seed,paths,blockLength,note
  };
  const unavailable=(reason:string):SynchronizedBootstrapReport=>({
    ...base,status:'insufficient_evidence',reason,endReturn:null,maxDrawdown:null,
    worstDailyReturn:null,maxClusterExposure:null,firstPathSourceIndices:null,
    firstPathPortfolioReturns:null
  });
  if(days.length<2||symbols.length<2)
    return unavailable('Mindestens zwei gemeinsame, vollständig belegte Tagesvektoren und Märkte erforderlich.');
  if(!clusters||symbols.some(s=>typeof clusters[s]!=='string'||!clusters[s]?.trim()))
    return unavailable('Unbekannte oder fehlende historische Clusterzuordnung.');
  const expected=JSON.stringify(symbols);
  let prev=-1;
  const portfolioReturns:number[]=[];
  const clusterMaxes:number[]=[];
  for(const day of days) {
    if(!Number.isSafeInteger(day.utcDayMs)||day.utcDayMs%DAY_MS!==0||
      day.utcDayMs<FIRST_DEV_DAY||day.utcDayMs>=END_DEV_DAY)
      return unavailable('Tageszeitpunkt ist ungültig oder ausserhalb 2020–2023.');
    if(prev>=0&&day.utcDayMs!==prev+DAY_MS)
      return unavailable('Fehlender, doppelter, ungeordneter oder veralteter gemeinsamer UTC-Tag.');
    prev=day.utcDayMs;
    if(!day.returns||!day.exposures||
      JSON.stringify(Object.keys(day.returns).sort())!==expected||
      JSON.stringify(Object.keys(day.exposures).sort())!==expected)
      return unavailable('Unvollständiger oder unerwarteter Markt-/Positionsvektor.');
    let portfolioReturn=0,totalWeight=0;
    const clustersByWeight=new Map<string,number>();
    for(const symbol of symbols) {
      const ret=day.returns[symbol],weight=day.exposures[symbol];
      if(typeof ret!=='number'||!Number.isFinite(ret)||ret< -1||
        typeof weight!=='number'||!Number.isFinite(weight)||weight<0||weight>1)
        return unavailable('Unbekannter Marktwert oder unzulässiges Positionsgewicht.');
      portfolioReturn+=ret*weight;
      totalWeight+=weight;
      const cluster=clusters[symbol]!;
      clustersByWeight.set(cluster,(clustersByWeight.get(cluster)??0)+weight);
    }
    if(totalWeight>1+1e-10||!Number.isFinite(portfolioReturn)||portfolioReturn< -1)
      return unavailable('Positionsgewichte überschreiten das vorhandene Kapital.');
    portfolioReturns.push(portfolioReturn);
    clusterMaxes.push(Math.max(...clustersByWeight.values()));
  }
  const generator=randomGenerator(seed);
  const ends:number[]=[],drawdowns:number[]=[],worsts:number[]=[],clustersMax:number[]=[];
  let firstPathSourceIndices:number[]|null=null,firstPathPortfolioReturns:number[]|null=null;
  for(let path=0;path<paths;path++){
    let sourceIndex=Math.floor(generator()*days.length);
    let equity=1,worst=Infinity,clusterExposure=0;
    const equities=[equity],indices:number[]=[],jointReturns:number[]=[];
    for(let t=0;t<days.length;t++){
      if(t>0){
        sourceIndex=generator()<1/blockLength?
          Math.floor(generator()*days.length):(sourceIndex+1)%days.length;
      }
      const ret=portfolioReturns[sourceIndex]!;
      equity*=1+ret;
      if(!Number.isFinite(equity)||equity<0)
        return unavailable('Numerisch ungültiger Szenariopfad.');
      equities.push(equity);
      worst=Math.min(worst,ret);
      clusterExposure=Math.max(clusterExposure,clusterMaxes[sourceIndex]!);
      if(path===0){indices.push(sourceIndex);jointReturns.push(ret);}
    }
    if(path===0){firstPathSourceIndices=indices;firstPathPortfolioReturns=jointReturns;}
    ends.push(equity-1);
    drawdowns.push(maxDrawdown(equities));
    worsts.push(worst);
    clustersMax.push(clusterExposure);
  }
  return {...base,status:'ok',reason:null,endReturn:band(ends),maxDrawdown:band(drawdowns),
    worstDailyReturn:band(worsts),maxClusterExposure:band(clustersMax),
    firstPathSourceIndices,firstPathPortfolioReturns};
}
