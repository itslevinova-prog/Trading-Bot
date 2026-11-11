import {beforeEach,afterEach,expect,test} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArchive,type ArchiveDb} from '../src/archive/store.js';
import {chooseDevelopmentSamples,publicRestUrl,verifySpotSample,
 verifyDevelopmentSource,writeSourceVerification,type SourceSample} from '../src/archive/verify-source.js';

const DAY=86_400_000,FROM=Date.UTC(2022,5,1),MIN=60_000;
let root:string,db:ArchiveDb;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'verify-spot-'));db=openArchive(join(root,'archive.db'));});
afterEach(()=>{db.close();rmSync(root,{recursive:true,force:true});});
function seed(symbol='BTCUSDT',intervalMin=1440,dayMs=FROM,count=DAY/(intervalMin*MIN)){
 const insert=db.prepare('INSERT INTO candles(symbol,interval_min,ts,open,high,low,close,volume,quote_volume,trades) '+
  'VALUES (?,?,?,?,?,?,?,?,?,?)');
 for(let i=0;i<count;i++)insert.run(symbol,intervalMin,dayMs+i*intervalMin*MIN,100,103,99,101,42,4242,7);
}
const sample=(intervalMin:15|60|1440=1440,dayMs=FROM,symbol='BTCUSDT'):SourceSample=>({symbol,intervalMin,dayMs});
function restRows(s:SourceSample):unknown[][]{
 const rows=db.prepare('SELECT ts,open,high,low,close,volume,quote_volume AS quoteVolume,trades FROM candles '+
  'WHERE symbol=? AND interval_min=? AND ts>=? AND ts<? ORDER BY ts')
  .all(s.symbol,s.intervalMin,s.dayMs,s.dayMs+DAY) as Array<{ts:number;open:number;high:number;low:number;close:number;volume:number;quoteVolume:number;trades:number}>;
 return rows.map(x=>[x.ts,String(x.open),String(x.high),String(x.low),String(x.close),
  String(x.volume),x.ts+s.intervalMin*MIN-1,String(x.quoteVolume),x.trades,'0','0','0']);
}
const response=(body:unknown,status=200):typeof fetch=>
 (async()=>({ok:status===200,status,text:async()=>JSON.stringify(body)})) as unknown as typeof fetch;
test('deterministic sample choice never selects validation or holdout dates',()=>{
 seed('BTCUSDT',1440,FROM);seed('ETHUSDT',1440,FROM+DAY);
 seed('BTCUSDT',1440,Date.UTC(2024,0,1));
 seed('BTCUSDT',1440,Date.UTC(2025,0,1));
 const a=chooseDevelopmentSamples(db,'stable-v1',2);
 expect(chooseDevelopmentSamples(db,'stable-v1',2)).toEqual(a);
 expect(a).toHaveLength(2);
 expect(a.every(s=>s.dayMs<Date.UTC(2024,0,1))).toBe(true);
 expect(()=>publicRestUrl(sample(1440,Date.UTC(2025,0,1)))).toThrow(/2020–2023/);
 expect(()=>chooseDevelopmentSamples(db,'bad seed',2)).toThrow();
});
test('matching independent REST response records hashes and source/receipt timestamps',async()=>{
 seed();const s=sample();let now=FROM+10*DAY;
 const result=await verifySpotSample(db,s,response(restRows(s)),()=>now++);
 expect(result.status).toBe('match');
 expect(result.reasons).toEqual([]);
 expect(result.archiveHash).toMatch(/^[a-f0-9]{64}$/);
 expect(result.restHash).toMatch(/^[a-f0-9]{64}$/);
 expect(result.sourceFirstAt).toBe(FROM);
 expect(result.sourceLastAt).toBe(FROM);
 expect(result.requestedAt).toBe(FROM+10*DAY);
 expect(result.receivedAt).toBe(FROM+10*DAY+1);
 expect(new URL(result.url).hostname).toBe('api.binance.com');
 expect(new URL(result.url).searchParams.get('limit')).toBe('1000');
});
test('scaled timestamps, wrong order and changed OHLC/volume are conflicts, never auto-repaired',async()=>{
 seed('BTCUSDT',60);const s=sample(60),good=restRows(s);
 const scaled=good.map(row=>[Number(row[0])*1000,...row.slice(1)]);
 expect((await verifySpotSample(db,s,response(scaled))).status).toBe('conflict');
 expect((await verifySpotSample(db,s,response([...good].reverse()))).reasons.join(' ')).toMatch(/order/);
 const mismatched=good.map(row=>[...row]);mismatched[0]![5]='999';
 const changed=await verifySpotSample(db,s,response(mismatched));
 expect(changed.status).toBe('conflict');
 expect(changed.reasons).toContain('volume mismatch at '+FROM);
 const after=db.prepare('SELECT volume FROM candles WHERE symbol=? AND interval_min=? AND ts=?')
  .get('BTCUSDT',60,FROM) as {volume:number};
 expect(after.volume).toBe(42);
});
test('REST outage and partial shared observations are unknown, not green',async()=>{
 seed('BTCUSDT',15,FROM,95);
 const s=sample(15);
 const partial=await verifySpotSample(db,s,response(restRows(s)));
 expect(partial.status).toBe('unknown');
 const offline=await verifySpotSample(db,s,(async()=>{throw Error('network offline');}) as typeof fetch);
 expect(offline.status).toBe('unknown');
 expect(offline.restHash).toBeNull();
 const badStatus=await verifySpotSample(db,s,response([],429));
 expect(badStatus.status).toBe('unknown');
 expect(badStatus.reasons).toContain('REST HTTP 429');
});
test('independent batch report counts reproducibly and never overwrites prior local evidence',async()=>{
 seed();seed('ETHUSDT',1440,FROM+DAY);
 const fixedClock=()=>FROM+20*DAY;
 const fetcher=(async(url:string)=>{
  const parsed=new URL(url),symbol=parsed.searchParams.get('symbol')!;
  const date=Number(parsed.searchParams.get('startTime')!);
  return {ok:true,status:200,text:async()=>JSON.stringify(restRows(sample(1440,date,symbol)))};
 }) as typeof fetch;
 const first=await verifyDevelopmentSource(db,{seed:'audit-v1',count:2,fetcher,clock:fixedClock});
 const second=await verifyDevelopmentSource(db,{seed:'audit-v1',count:2,fetcher,clock:()=>FROM+21*DAY});
 expect(first.status).toBe('passed');
 expect(first.counts).toEqual({matched:2,conflicts:0,unknown:0});
 expect(first.fingerprint).toBe(second.fingerprint);
 expect(first.sampleFingerprint).toBe(second.sampleFingerprint);
 const file=writeSourceVerification(first,join(root,'reports'));
 const original=readFileSync(file,'utf8');
 expect(writeSourceVerification(second,join(root,'reports'))).toBe(file);
 expect(readFileSync(file,'utf8')).toBe(original);
 const missing=await verifyDevelopmentSource(db,{seed:'audit-v1',count:3,fetcher});
 expect(missing.status).toBe('unknown');
 expect(missing.selected).toBe(2);
});
