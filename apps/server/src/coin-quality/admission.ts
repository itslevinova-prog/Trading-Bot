import type {CoinQualityProvider,QualityVerdict} from './contracts.js';

export type CoinQualityAdmission = {allowed:boolean;reason:string;verdict:QualityVerdict|null};

/** Unified admission, called just before a buy order in paper and closed-candle
 * replay. A provider failure or an uncertain result never permits exposure. */
export async function requireCoinQualityEntry(
 provider: Pick<CoinQualityProvider,'check'>,
 pair: string,
 asOf: number,
 mode: 'paper'|'backtest',
): Promise<CoinQualityAdmission> {
 if (!/^[A-Z0-9]{2,20}\/?[A-Z0-9]{3,6}$/.test(pair) ||
   !Number.isSafeInteger(asOf) || asOf<0)
   return {allowed:false,reason:'Invalid coin quality query',verdict:null};
 const symbol=pair.toUpperCase().replace('/','');
 try {
  const verdict=await provider.check(pair,asOf);
  const lag=mode==='paper'?60_000:0;
  if (!verdict || verdict.symbol!==symbol ||
    !Number.isSafeInteger(verdict.asOf) || verdict.asOf<asOf-lag ||
    verdict.asOf>asOf+lag || !Array.isArray(verdict.reasons) || verdict.reasons.length===0 ||
    !Array.isArray(verdict.sources) || verdict.sources.length===0 || !['allowed','hold-only','exit','unknown'].includes(verdict.status) ||
    verdict.sources.some(s=>!s.name || typeof s.official!=='boolean' ||
      !Number.isSafeInteger(s.fetchedAt)||
      s.fetchedAt>verdict.asOf || s.fetchedAt<0))
   return {allowed:false,reason:'Coin quality verdict missing, stale, mismatched or future-dated',verdict:null};
  if (verdict.status!=='allowed')return {allowed:false,
    reason:'Coin quality '+verdict.status+': '+verdict.reasons.join('; '),verdict};
  return {allowed:true,reason:'Coin quality allowed from validated source',verdict};
 } catch(error) {
  return {allowed:false,
   reason:'Coin quality source unavailable; no new exposure: '+
     String(error instanceof Error?error.message:error),verdict:null};
 }
}
