import {expect,test} from 'vitest';
import {assessFundingSpotFilter,FUNDING_SPOT_VARIANTS,
 type FundingObservation,type FundingSpotInput} from '../src/strategy/funding-spot-filter.js';

const AS_OF=Date.UTC(2022,6,1),EIGHT_HOURS=8*3_600_000,MINUTE=60_000;
function history(lastRate=.05):FundingObservation[]{
 return Array.from({length:92},(_,i)=>{
  const intervalEndMs=AS_OF-(92-i)*EIGHT_HOURS;
  return {symbol:'BTCUSDT',intervalEndMs,
   publishedAtMs:intervalEndMs+5*MINUTE,
   receivedAtMs:intervalEndMs+7*MINUTE,
   fundingRate:i===91?lastRate:Math.sin(i/3)*.0005,
   sourceId:'local-public-funding-fixture'};
 });
}
const input=(extra:Partial<FundingSpotInput>={}):FundingSpotInput=>({
 symbol:'BTCUSDT',asOf:AS_OF,variant:'above-p90-block',
 baseSpotBuyAllowed:true,history:history(),...extra
});
test('exactly two frozen percentile signs can only veto SPOT entries',()=>{
 expect(Object.keys(FUNDING_SPOT_VARIANTS)).toEqual(['above-p90-block','below-p10-block']);
 const high=assessFundingSpotFilter(input());
 expect(high).toMatchObject({version:'H-028-v1',status:'blocked',
  spotBuyAllowed:false,latestFundingRate:.05,executableOrder:false});
 expect(high.observations).toBeGreaterThanOrEqual(60);
 expect(high.coveredUtcDays).toBeGreaterThanOrEqual(20);
 const opposite=assessFundingSpotFilter(input({variant:'below-p10-block'}));
 expect(opposite.status).toBe('allowed');
 expect(opposite.spotBuyAllowed).toBe(true);
 const low=assessFundingSpotFilter(input({variant:'below-p10-block',history:history(-.05)}));
 expect(low.status).toBe('blocked');
 expect(low.spotBuyAllowed).toBe(false);
});
test('future publication and future 8-hour funding do not alter the decision',()=>{
 const baseline=assessFundingSpotFilter(input());
 const future:FundingObservation={symbol:'BTCUSDT',intervalEndMs:AS_OF-EIGHT_HOURS/2,
  publishedAtMs:AS_OF+5*MINUTE,receivedAtMs:AS_OF+7*MINUTE,
  fundingRate:-.09,sourceId:'local-future-fixture'};
 const next:FundingObservation={...future,intervalEndMs:AS_OF+EIGHT_HOURS,
  publishedAtMs:AS_OF+EIGHT_HOURS+5*MINUTE,
  receivedAtMs:AS_OF+EIGHT_HOURS+7*MINUTE,fundingRate:.09};
 expect(assessFundingSpotFilter(input({history:[...history(),future,next]}))).toEqual(baseline);
 expect(assessFundingSpotFilter(input({history:[
  ...history(),{...future,symbol:'ETHUSDT',publishedAtMs:AS_OF-3*MINUTE,receivedAtMs:AS_OF-2*MINUTE}
 ]}))).toEqual(baseline);
});
test('missing/stale snapshots, poor coverage, invalid provenance and duplicate intervals fail closed',()=>{
 expect(assessFundingSpotFilter(input({history:[]})).status).toBe('unknown');
 expect(assessFundingSpotFilter(input({history:history().slice(-15)})).status).toBe('unknown');
 expect(assessFundingSpotFilter(input({history:history().slice(0,-6)})).status).toBe('unknown');
 const faulty=history();faulty[91]={...faulty[91]!,sourceId:''};
 expect(assessFundingSpotFilter(input({history:faulty})).status).toBe('unknown');
 const duplicated=[...history(),history().at(-1)!];
 expect(assessFundingSpotFilter(input({history:duplicated})).status).toBe('unknown');
});
test('filter never overrides an original H-025 veto or tests validation/holdout',()=>{
 expect(assessFundingSpotFilter(input({baseSpotBuyAllowed:false,history:history(0)})).status)
  .toBe('blocked');
 expect(assessFundingSpotFilter(input({asOf:Date.UTC(2024,0,2)})).status)
  .toBe('unknown');
 expect(()=>assessFundingSpotFilter(input({variant:'best-after-holdout' as 'above-p90-block'})))
  .toThrow(/preregistered/);
});
