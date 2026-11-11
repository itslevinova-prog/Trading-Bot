import {expect,test} from 'vitest';
import {adviseQualityExit} from '../src/coin-quality/exit-guidance.js';
import type {PublicSignal,RiskProfile} from '../src/coin-quality/contracts.js';

const DAY=86_400_000;
const at=Date.UTC(2023,5,1,12);
const symbol='BTCUSDT';
const feed=(symbols:string[]=[],extra:Partial<PublicSignal>={}):PublicSignal=>({
  available:true,fetchedAt:at-60_000,symbols,clearForAll:true,
  coverage:[symbol],...extra
});
const check=(profile:RiskProfile,tags:PublicSignal|null,delistings:PublicSignal|null)=>
  adviseQualityExit({symbol,tags,delistings},at,profile);

test('delisting advisory preserves profile deadlines and never submits orders',()=>{
  const delist=feed([symbol],{effectiveAt:{[symbol]:at+3*DAY}});
  const prudent=check('vorsichtig',feed(),delist);
  expect(prudent.action).toBe('exit-now');
  expect(prudent.deadlineMs).toBeNull();
  expect(prudent.automaticExecution).toBe(false);
  const normal=check('normal',feed(),delist);
  expect(normal.action).toBe('exit-by');
  expect(normal.deadlineMs).toBe(at+DAY);
  const aggressive=check('aggressiv',feed(),delist);
  expect(aggressive.action).toBe('exit-by');
  expect(aggressive.deadlineMs).toBe(at+3*DAY-1);
  expect(aggressive.sources).toBe('unofficial-public-signals');
});

test('already-passed delisting deadline means immediate review, missing date cannot invent a schedule',()=>{
  const older=feed([symbol],{effectiveAt:{[symbol]:at-60_000}});
  for(const profile of ['vorsichtig','normal','aggressiv'] as const)
    expect(check(profile,feed(),older).action).toBe('exit-now');
  const noDate=feed([symbol]);
  const normal=check('normal',feed(),noDate);
  expect(normal.deadlineMs).toBe(at+DAY);
  const aggressive=check('aggressiv',feed(),noDate);
  expect(aggressive.action).toBe('review');
  expect(aggressive.deadlineMs).toBeNull();
});

test('monitoring without delisting demands caution but not a fabricated forced exit for all profiles',()=>{
  const tag=feed([symbol]);
  expect(check('vorsichtig',tag,feed()).action).toBe('exit-by');
  expect(check('vorsichtig',tag,feed()).deadlineMs).toBe(at+DAY);
  expect(check('normal',tag,feed()).action).toBe('hold-only');
  expect(check('aggressiv',tag,feed()).action).toBe('hold-only');
  const both=check('normal',tag,feed([symbol]));
  expect(both.action).toBe('exit-by'); // Delisting has priority.
});

test('unknown, stale, future or unscoped public feed cannot clear warnings retrospectively',()=>{
  for(const partial of [
    null,feed([],{available:false}),feed([],{fetchedAt:at+1}),
    feed([],{fetchedAt:at-49*3_600_000}),
    feed([],{coverage:undefined}),
    feed([],{coverage:['ETHUSDT']})
  ]){
    expect(check('normal',partial,feed()).action).toBe('review');
  }
  expect(check('normal',feed(),feed()).action).toBe('no-exit-indication');
  expect(check('normal',feed([symbol],{fetchedAt:at+1}),feed()).action)
    .toBe('review'); // Future flag is ignored and the source is not treated as clear.
  expect(check('normal',feed([symbol],{fetchedAt:at-49*3_600_000}),feed()).action)
    .toBe('review');
});

test('invalid clocks, profiles and symbols are rejected, all responses remain advisory',()=>{
  expect(()=>adviseQualityExit({symbol,tags:feed(),delistings:feed()},-1,'normal'))
    .toThrow(/Invalid point-in-time/);
  expect(()=>adviseQualityExit({symbol,tags:feed(),delistings:feed()},at,'invalid' as RiskProfile))
    .toThrow(/Invalid point-in-time/);
  expect(()=>adviseQualityExit({symbol:'btc/usdt',tags:feed(),delistings:feed()},at,'normal'))
    .toThrow(/Invalid exit guidance symbol/);
  const neutral=check('normal',feed(),feed());
  expect(neutral.automaticExecution).toBe(false);
  expect(neutral.reason).toContain('not proof of safety');
});
