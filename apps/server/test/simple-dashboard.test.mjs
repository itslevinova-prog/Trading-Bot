import {expect,test} from 'vitest';
import {changeSince,getSimpleStatus,observedMaxDrop} from '../../web/src/pages/simple-dashboard-data.ts';

const now=Date.UTC(2026,10,7,12);
const healthy={connected:true,checkedAt:now,pairs:2,freshBooks:2,protectiveExitFailures:0};
const safeRisk={accounts:[{accountId:'rules',latched:false,current:{approved:false}}]};
test('never reports all-clear when reconciliation and strategy monitoring are unproven',()=>{
 expect(getSimpleStatus({serverError:'',connected:true,health:healthy,risk:safeRisk,now})).toMatchObject({
  color:'yellow',title:'Bisher keine Störung erkennbar'
 });
 expect(getSimpleStatus({serverError:'',connected:true,health:null,risk:safeRisk,now}).color).toBe('yellow');
 expect(getSimpleStatus({serverError:'',connected:true,health:healthy,risk:null,now}).color).toBe('yellow');
 expect(getSimpleStatus({serverError:'',connected:true,health:{...healthy,checkedAt:now-31_000},risk:safeRisk,now}).color).toBe('yellow');
});
test('distinguishes observed safety stops from feed problems and server outages',()=>{
 expect(getSimpleStatus({serverError:'offline',connected:false,health:null,risk:null,now}).color).toBe('red');
 expect(getSimpleStatus({serverError:'',connected:true,health:{...healthy,protectiveExitFailures:1},risk:safeRisk,now}).color).toBe('red');
 expect(getSimpleStatus({serverError:'',connected:true,health:healthy,risk:{accounts:[{accountId:'rules',latched:true,current:null}]},now}).color).toBe('red');
 expect(getSimpleStatus({serverError:'',connected:true,health:{...healthy,freshBooks:1},risk:safeRisk,now}).color).toBe('yellow');
 expect(getSimpleStatus({serverError:'',connected:false,health:healthy,risk:safeRisk,now}).color).toBe('yellow');
});
test('changes require an observed historical anchor; unknown is not zero',()=>{
 const day=86_400_000;
 const points=[{accountId:'rules',ts:now-2*day,equity:200},
  {accountId:'rules',ts:now-day,equity:180},
  {accountId:'rules',ts:now,equity:190},
  {accountId:'other',ts:now-10*day,equity:100}];
 expect(changeSince(points,'rules',now,day,190)).toEqual({value:10,percent:(190/180-1)*100});
 expect(changeSince(points,'rules',now,7*day,190)).toBeNull();
 expect(changeSince(points,'rules',now,day,null)).toBeNull();
 expect(observedMaxDrop(points,'rules')).toBeCloseTo(10);
 expect(observedMaxDrop([],'rules')).toBeNull();
});
