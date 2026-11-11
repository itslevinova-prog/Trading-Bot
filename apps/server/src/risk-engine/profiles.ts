import {DEFAULT_RISK_LIMITS,type RiskLimits} from './engine.js';

/** Paper-only profile candidates from issue #10. They are not selected by a
 * strategy or exchange adapter before prerequisite validation and sign-off. */
export type RiskProfileName='vorsichtig'|'normal'|'aggressiv';
export type ResearchProfile={
 targetAnnualVol:number;maxInvestedPct:number;corePct:number;
 universeTopN:number;maxOpenPositions:number;maxPositionPct:number;
 riskPerTradePct:number;maxPortfolioBeta:number;
 cautionDrawdown:number;exitOnlyDrawdown:number;minimumEdgeMultiple:number;
};
export const RESEARCH_RISK_PROFILES:Readonly<Record<RiskProfileName,Readonly<ResearchProfile>>>=
 Object.freeze({
  vorsichtig:Object.freeze({targetAnnualVol:.15,maxInvestedPct:.50,corePct:.60,
   universeTopN:5,maxOpenPositions:3,maxPositionPct:.15,riskPerTradePct:.005,
   maxPortfolioBeta:.60,cautionDrawdown:.05,exitOnlyDrawdown:.10,minimumEdgeMultiple:3}),
  normal:Object.freeze({targetAnnualVol:.25,maxInvestedPct:.80,corePct:.30,
   universeTopN:10,maxOpenPositions:5,maxPositionPct:.25,riskPerTradePct:.01,
   maxPortfolioBeta:.90,cautionDrawdown:.10,exitOnlyDrawdown:.20,minimumEdgeMultiple:2}),
  aggressiv:Object.freeze({targetAnnualVol:.40,maxInvestedPct:1,corePct:0,
   universeTopN:20,maxOpenPositions:7,maxPositionPct:.35,riskPerTradePct:.015,
   maxPortfolioBeta:1.2,cautionDrawdown:.15,exitOnlyDrawdown:.30,minimumEdgeMultiple:1.5})
 });

/** Untunable current production ceilings. A profile may only tighten them.
 * The values intentionally do NOT implement a more lenient drawdown stop. */
export const ABSOLUTE_PAPER_RISK_CAPS=Object.freeze({
 targetAnnualVol:DEFAULT_RISK_LIMITS.targetAnnualVol,
 maxInvestedPct:1,maxOpenPositions:4,
 maxPositionPct:DEFAULT_RISK_LIMITS.maxPositionPct,
 riskPerTradePct:.015,maxPortfolioBeta:DEFAULT_RISK_LIMITS.maxPortfolioBeta,
 cautionDrawdown:DEFAULT_RISK_LIMITS.cautionDrawdown,
 exitOnlyDrawdown:DEFAULT_RISK_LIMITS.exitOnlyDrawdown,
 hardStopDrawdown:DEFAULT_RISK_LIMITS.hardStopDrawdown
});
type OverrideKey=keyof typeof ABSOLUTE_PAPER_RISK_CAPS;
export type PaperProfileOverrides=Partial<Pick<ResearchProfile,Exclude<OverrideKey,'hardStopDrawdown'>>>;
export type ResolvedPaperProfile={
 name:RiskProfileName;
 requested:Readonly<ResearchProfile>;
 /** Capped profile for paper-only fixture verification; not a trading approval. */
 effective:Readonly<ResearchProfile>;
 engineLimits:Readonly<RiskLimits>;
 hardStopDrawdown:number;
 cappedFields:readonly string[];
 overrideFields:readonly string[];
 /** No automatic changes to existing positions, core rebalancing, or live mode. */
 automaticRebalance:false;
};
const valid=(n:number)=>Number.isFinite(n)&&n>=0;
const capKeys=[
 'targetAnnualVol','maxInvestedPct','maxOpenPositions','maxPositionPct',
 'riskPerTradePct','maxPortfolioBeta','cautionDrawdown','exitOnlyDrawdown'
] as const;
export function resolvePaperRiskProfile(
 profile:RiskProfileName='vorsichtig',overrides:PaperProfileOverrides={}
):ResolvedPaperProfile {
 if(!Object.prototype.hasOwnProperty.call(RESEARCH_RISK_PROFILES,profile))
  throw Error('Unknown risk profile; only three pre-registered candidates permitted');
 const requested=RESEARCH_RISK_PROFILES[profile];
 const provided=Object.entries(overrides);
 for(const [key,value] of provided){
  if(!capKeys.some(k=>k===key)||typeof value!=='number'||!valid(value)||
    value>(ABSOLUTE_PAPER_RISK_CAPS as Record<string,number>)[key]!||
    (key==='maxOpenPositions'&&!Number.isSafeInteger(value)))
   throw Error('Invalid or above-absolute-cap paper risk override: '+key);
 }
 const effective={...requested};
 const cappedFields:string[]=[];
 for(const key of capKeys){
  const limit=ABSOLUTE_PAPER_RISK_CAPS[key];
  const chosen=Object.prototype.hasOwnProperty.call(overrides,key)?
   overrides[key as keyof PaperProfileOverrides]!:requested[key];
  const applied=Math.min(chosen,limit);
  if(applied!==chosen)cappedFields.push(key);
  (effective as unknown as Record<string,number>)[key]=applied;
 }
 if(effective.targetAnnualVol<=0||effective.maxInvestedPct<=0||
  effective.maxOpenPositions<1||effective.maxPositionPct<=0||
  effective.riskPerTradePct<=0||effective.maxPortfolioBeta<=0||
  effective.cautionDrawdown<0||effective.exitOnlyDrawdown<=effective.cautionDrawdown||
  effective.maxPositionPct>effective.maxInvestedPct)
  throw Error('Invalid or non-monotone resolved paper risk profile');
 const engineLimits:RiskLimits={...DEFAULT_RISK_LIMITS,
  targetAnnualVol:effective.targetAnnualVol,
  maxPortfolioBeta:effective.maxPortfolioBeta,
  maxPositionPct:effective.maxPositionPct,
  cautionDrawdown:effective.cautionDrawdown,
  exitOnlyDrawdown:effective.exitOnlyDrawdown,
  hardStopDrawdown:ABSOLUTE_PAPER_RISK_CAPS.hardStopDrawdown
 };
 return Object.freeze({
  name:profile,requested,effective:Object.freeze(effective),
  engineLimits:Object.freeze(engineLimits),
  hardStopDrawdown:ABSOLUTE_PAPER_RISK_CAPS.hardStopDrawdown,
  cappedFields:Object.freeze(cappedFields),
  overrideFields:Object.freeze(provided.map(([key])=>key)),
  automaticRebalance:false as const
 });
}

/** Advisory only. More exposure needs an explicit owner decision; existing
 * holdings are never automatically resized as a consequence of switching. */
export function planPaperProfileSwitch(
 from:ResolvedPaperProfile,to:ResolvedPaperProfile,ownerConfirmed=false
):{allowed:boolean;requiresConfirmation:boolean;reasons:string[];existingHoldingsUntouched:true}{
 const widened=capKeys.some(key=>to.effective[key]>from.effective[key]);
 return {allowed:!widened||ownerConfirmed,requiresConfirmation:widened&&!ownerConfirmed,
  reasons:widened&&!ownerConfirmed?['Risikoreicheres Profil benötigt ausdrückliche Freigabe']:
   ['Änderung gilt nur für neue Paper-Einstiege; keine automatische Umschichtung'],
  existingHoldingsUntouched:true};
}
