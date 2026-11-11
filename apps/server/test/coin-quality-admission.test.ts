import {test,expect,vi} from 'vitest';
import {requireCoinQualityEntry} from '../src/coin-quality/admission.js';

const asOf=Date.UTC(2023,1,1);
const result=(status:'allowed'|'exit'|'hold-only'|'unknown',overrides:Record<string,unknown>={})=>({
 symbol:'BTCUSDT',asOf,status,reasons:['fixture decision'],
 sources:[{name:'fixture public sources',fetchedAt:asOf,official:true}],...overrides
});
test('point-in-time verdicts are required and no future fixture may allow a buy',async()=>{
 const check=vi.fn(async()=>result('allowed'));
 expect((await requireCoinQualityEntry({check},'BTC/USDT',asOf,'backtest')).allowed).toBe(true);
 expect(check).toHaveBeenCalledWith('BTC/USDT',asOf);
 for(const status of ['exit','hold-only','unknown'] as const)
  expect((await requireCoinQualityEntry({check:async()=>result(status)},'BTC/USDT',asOf,'backtest')).allowed).toBe(false);
 expect((await requireCoinQualityEntry({check:async()=>result('allowed',{asOf:asOf+1})},
  'BTC/USDT',asOf,'backtest')).allowed).toBe(false);
 expect((await requireCoinQualityEntry({check:async()=>result('allowed',{symbol:'ETHUSDT'})},
  'BTC/USDT',asOf,'paper')).allowed).toBe(false);
});
test('provider exceptions, incomplete source metadata and stale paper data fail closed',async()=>{
 expect((await requireCoinQualityEntry({check:async()=>{throw Error('offline')}},
  'BTC/USDT',asOf,'paper')).reason).toContain('unavailable');
 expect((await requireCoinQualityEntry({check:async()=>result('allowed',{asOf:asOf-61_000})},
  'BTC/USDT',asOf,'paper')).allowed).toBe(false);
 expect((await requireCoinQualityEntry({check:async()=>result('allowed',{sources:[
  {name:'future source',fetchedAt:asOf+1,official:true}]})},
  'BTC/USDT',asOf,'backtest')).allowed).toBe(false);
});
