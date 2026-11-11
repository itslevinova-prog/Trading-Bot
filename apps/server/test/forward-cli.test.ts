import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main,request} from '../src/forward/cli.js';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('forward public data CLI',()=>{
 it('uses only the public market-data host',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
  await request('exchangeInfo');expect(fetch.mock.calls[0]![0]).toBe('https://data-api.binance.vision/api/v3/exchangeInfo');
 });
 it('explains HTTP 451 without retry or trading-host fallback',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('',{status:451}));vi.stubGlobal('fetch',fetch);
  await expect(request('exchangeInfo')).rejects.toThrow(/Standort.*HTTP 451/);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('dry-runs fixtures without enabling forward, network, output files or Git',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forward-cli-')),fixture=join(dir,'fixture.json'),output=join(dir,'output'),argv=process.argv;
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);vi.stubEnv('FORWARD_ENABLED','');vi.stubEnv('LIVE_ENABLED','false');vi.stubEnv('AI_ALLOW_REMOTE','false');vi.stubEnv('LIVE_ACK','');
  writeFileSync(fixture,JSON.stringify({until:Date.UTC(2026,10,2),rows:{},lotRules:Object.fromEntries(['BTCUSDT','ETHUSDT'].map(s=>[s,{stepSize:'0.001',minQty:'0.001',minNotional:'5'}]))}));
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  try{
   process.argv=['node','forward-cli','--dry-run','--start','2026-11-01','--fixture',fixture,'--output',output];
   await main();expect(fetch).not.toHaveBeenCalled();expect(existsSync(output)).toBe(false);
   expect(JSON.parse(log.mock.calls[0]![0]).dryRun).toBe(true);
   process.argv=process.argv.filter(a=>a!=='--dry-run');
   await expect(main()).rejects.toThrow('Forward disabled');expect(existsSync(output)).toBe(false);
  }finally{process.argv=argv;rmSync(dir,{recursive:true});}
 });
});
