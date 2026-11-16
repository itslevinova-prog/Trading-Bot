import {test,expect} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claimValidation2024Once,H025_VALIDATION_PERIOD,validateValidation2024Plan,
 validation2024PlanHash} from '../src/pipeline/validation-2024-guard.js';
const split={version:1,immutable:true,development:{start:'2020-01-01',end:'2023-12-31'},
 validation:{start:'2024-01-01',end:'2024-12-31'},holdout:{start:'2025-01-01'}};
const plan=()=>({version:1,candidate:'v5.1',developmentResultSha256:'a'.repeat(64),
 preregisteredAt:'2026-11-16T09:00:00.000Z',
 criteria:{maxDrawdownBelow:.30,calmarAboveBenchmark:'BTC/ETH 50/50 halten'},
 profiles:['basis','vorsichtig','normal','aggressiv'],
 period:{from:'2024-01-01',toExclusive:'2025-01-01'}});
test('2024 guard accepts exactly one candidate, one year and all four predetermined profiles',()=>{
 expect(validateValidation2024Plan(plan(),split)).toEqual(plan());
 expect(H025_VALIDATION_PERIOD.from).toBe('2024-01-01');
 expect(H025_VALIDATION_PERIOD.toExclusive).toBe('2025-01-01');
 expect(validation2024PlanHash(plan() as never)).toMatch(/^[a-f0-9]{64}$/);
 for(const mutated of [
  {...plan(),candidate:['v5','v5.1']},
  {...plan(),candidate:'v6'},
  {...plan(),period:{from:'2024-01-01',toExclusive:'2026-01-01'}},
  {...plan(),profiles:['basis']},
  {...plan(),developmentResultSha256:''},
  {...plan(),criteria:{maxDrawdownBelow:.60,calmarAboveBenchmark:'BTC/ETH 50/50 halten'}},
  {...plan(),criteria:{maxDrawdownBelow:.30,calmarAboveBenchmark:'BTC-Halten'}},
  {...plan(),extra:'hidden-candidate'}
 ])expect(()=>validateValidation2024Plan(mutated,split)).toThrow();
 expect(()=>validateValidation2024Plan(plan(),{...split,holdout:{start:'2024-01-01'}})).toThrow();
});
test('a 2024 validation attempt is consumed with an atomic create-only marker, even if no report was produced',()=>{
 const temp=mkdtempSync(join(tmpdir(),'h025-validation-'));
 try{
  const path=join(temp,'validation-2024','attempt.json');
  const checked=validateValidation2024Plan(plan(),split);
  const claim=claimValidation2024Once(path,checked,new Date('2026-11-16T12:00:00Z'));
  expect(claim).toMatchObject({candidate:'v5.1',status:'consumed',scope:'calendar-2024-only'});
  expect(claim.planHash).toBe(validation2024PlanHash(checked));
  expect(JSON.parse(readFileSync(path,'utf8'))).toEqual(claim);
  expect(()=>claimValidation2024Once(path,checked)).toThrow();
  expect(readFileSync(path,'utf8')).toContain(claim.planHash);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
