import {test,expect} from 'vitest';
import {PortfolioRiskEngine,DEFAULT_RISK_LIMITS} from '../src/risk-engine/engine.js';
import {ABSOLUTE_PAPER_RISK_CAPS,RESEARCH_RISK_PROFILES,
 resolvePaperRiskProfile,planPaperProfileSwitch} from '../src/risk-engine/profiles.js';

test('only three pre-registered paper research profiles exist; default is cautious',()=>{
 expect(Object.keys(RESEARCH_RISK_PROFILES)).toEqual(['vorsichtig','normal','aggressiv']);
 expect(resolvePaperRiskProfile().name).toBe('vorsichtig');
 expect(resolvePaperRiskProfile('vorsichtig').effective).toMatchObject({
  targetAnnualVol:.15,maxInvestedPct:.5,maxOpenPositions:3,
  maxPositionPct:.15,riskPerTradePct:.005,maxPortfolioBeta:.6
 });
});

test('no profile widens the existing default PortfolioRiskEngine safety ceilings',()=>{
 for(const name of ['vorsichtig','normal','aggressiv'] as const){
  const p=resolvePaperRiskProfile(name);
  expect(()=>new PortfolioRiskEngine({...p.engineLimits})).not.toThrow();
  for(const key of ['targetAnnualVol','maxPositionPct','maxPortfolioBeta',
   'cautionDrawdown','exitOnlyDrawdown'] as const)
   expect(p.engineLimits[key]).toBeLessThanOrEqual(DEFAULT_RISK_LIMITS[key]);
  expect(p.hardStopDrawdown).toBe(DEFAULT_RISK_LIMITS.hardStopDrawdown);
  expect(p.effective.maxOpenPositions).toBeLessThanOrEqual(4);
  expect(p.effective.maxInvestedPct).toBeLessThanOrEqual(1);
  expect(p.effective.riskPerTradePct).toBeLessThanOrEqual(.015);
  expect(p.automaticRebalance).toBe(false);
 }
 const aggressive=resolvePaperRiskProfile('aggressiv');
 expect(aggressive.requested.targetAnnualVol).toBe(.4);
 expect(aggressive.effective.targetAnnualVol).toBe(.3);
 expect(aggressive.effective.maxOpenPositions).toBe(4);
 expect(aggressive.effective.maxPositionPct).toBe(.3);
 expect(aggressive.effective.maxPortfolioBeta).toBe(.8);
 expect(aggressive.engineLimits.hardStopDrawdown).toBe(.15);
 expect(aggressive.cappedFields).toContain('targetAnnualVol');
 expect(ABSOLUTE_PAPER_RISK_CAPS).toMatchObject({hardStopDrawdown:.15});
});

test('explicit override may only tighten below immutable hard caps, never raise them',()=>{
 const p=resolvePaperRiskProfile('normal',{maxPositionPct:.2,maxInvestedPct:.7,maxOpenPositions:2});
 expect(p.effective).toMatchObject({maxPositionPct:.2,maxInvestedPct:.7,maxOpenPositions:2});
 expect(p.overrideFields).toEqual(['maxPositionPct','maxInvestedPct','maxOpenPositions']);
 expect(()=>resolvePaperRiskProfile('vorsichtig',{maxPositionPct:.5})).toThrow(/cap/);
 expect(()=>resolvePaperRiskProfile('normal',{targetAnnualVol:.32})).toThrow(/cap/);
 expect(()=>resolvePaperRiskProfile('vorsichtig',{maxOpenPositions:5})).toThrow(/cap/);
 expect(()=>resolvePaperRiskProfile('vorsichtig',{riskPerTradePct:Infinity})).toThrow();
 expect(()=>resolvePaperRiskProfile('normal',{maxOpenPositions:2.5})).toThrow();
 expect(()=>resolvePaperRiskProfile('vorsichtig',{maxPositionPct:0})).toThrow();
 expect(()=>resolvePaperRiskProfile('vorsichtig',{maxInvestedPct:.05})).toThrow();
 expect(()=>resolvePaperRiskProfile('unbekannt' as 'vorsichtig')).toThrow();
});

test('a more generous paper mode requires acknowledgement but never auto-resizes holdings',()=>{
 const cautious=resolvePaperRiskProfile('vorsichtig');
 const normal=resolvePaperRiskProfile('normal');
 const aggressive=resolvePaperRiskProfile('aggressiv');
 expect(planPaperProfileSwitch(cautious,normal)).toMatchObject({
  allowed:false,requiresConfirmation:true,existingHoldingsUntouched:true
 });
 expect(planPaperProfileSwitch(normal,aggressive)).toMatchObject({
  allowed:false,requiresConfirmation:true
 });
 expect(planPaperProfileSwitch(cautious,normal,true)).toMatchObject({
  allowed:true,requiresConfirmation:false,existingHoldingsUntouched:true
 });
 expect(planPaperProfileSwitch(aggressive,cautious)).toMatchObject({
  allowed:true,requiresConfirmation:false,existingHoldingsUntouched:true
 });
});
