import {afterEach, describe, expect, test} from 'vitest';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ArchiveCoinQualityProvider, LiveCoinQualityProvider, allowsEntry} from '../src/coin-quality/providers.js';
import {QualityPublicSources} from '../src/coin-quality/sources.js';
import {QualityStore} from '../src/coin-quality/storage.js';
import {archiveTerminalSettlement, assessQuote, DEFAULT_QUALITY_CONFIG,
  evaluateQuality, median30At, type PublicSignal, type QualityInput} from '../src/coin-quality/contracts.js';
import {settleTerminalArchivePosition, type CandleSource} from '../src/coin-quality/archive-contract.js';

const DAY = 86_400_000;
const asOf = Date.UTC(2026,10,5,12);
const config = {...DEFAULT_QUALITY_CONFIG};
const feed = (symbols: string[] = [], opts: Partial<PublicSignal> = {}): PublicSignal =>
  ({available:true,fetchedAt:asOf-60_000,symbols,clearForAll:true,...opts});
const base = (extra: Partial<QualityInput> = {}): QualityInput => ({
  symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',status:'TRADING',spotAllowed:true,
  listedAtMs:asOf-130*DAY,volumes:Array.from({length:30},(_,i) => ({
    ts:Math.floor(asOf/DAY)*DAY-(i+1)*DAY,quoteVolume:8_000_000,
  })),
  spreadBps:12,tags:feed(),delistings:feed(),
  sources:[{name:'fixture market',fetchedAt:asOf-60_000,official:true}],...extra,
});
const healthy = {ok:true,deviationBps:0,reasons:[]};

describe('point-in-time coin rules', () => {
  test('clear mature/liquid coin is allowed with reasons and sources', () => {
    const verdict = evaluateQuality(base(),asOf,config,healthy);
    expect(verdict.status).toBe('allowed');
    expect(allowsEntry(verdict)).toBe(true);
    expect(verdict.sources[0]?.official).toBe(true);
  });
  test('excluded stable/fiat and leveraged bases, age, liquidity and spread', () => {
    for (const baseAsset of ['USDC','EUR','BTCUP','ETHDOWN','FOO3L']) {
      expect(evaluateQuality(base({baseAsset}),asOf,config,healthy).status).not.toBe('allowed');
    }
    expect(evaluateQuality(base({listedAtMs:asOf-5*DAY}),asOf,config,healthy).status).toBe('hold-only');
    expect(evaluateQuality(base({volumes:base().volumes.map(v => ({...v,quoteVolume:1_000_000}))}),asOf,config,healthy).status).toBe('hold-only');
    expect(evaluateQuality(base({spreadBps:40}),asOf,config,healthy).status).toBe('hold-only');
    expect(evaluateQuality(base({status:'BREAK'}),asOf,config,healthy).reasons.join()).toContain('keine Orders');
  });
  test('monitoring tag and announced delisting apply separate risk profiles', () => {
    for (const profile of ['vorsichtig','normal','aggressiv'] as const) {
      const tag = evaluateQuality(base({tags:feed(['BTCUSDT'])}),asOf,{...config,profile},healthy);
      expect(tag.status).toBe(profile === 'vorsichtig' ? 'exit' : 'hold-only');
      const delist = evaluateQuality(base({delistings:feed(['BTCUSDT'])}),asOf,{...config,profile},healthy);
      expect(delist.status).toBe('exit');
      expect(delist.reasons.join(' ')).toContain(profile === 'vorsichtig' ? 'sofortiger' :
        profile === 'normal' ? '24 h' : 'vor Delisting-Datum');
    }
  });
  test('unreachable, ambiguous, stale and future feeds are all unknown', () => {
    for (const tags of [
      null,feed([],{available:false}),feed([],{clearForAll:false}),
      feed([],{fetchedAt:asOf-49*3_600_000}),feed([],{fetchedAt:asOf+1000}),
    ]) {
      const verdict = evaluateQuality(base({tags}),asOf,config,healthy);
      expect(verdict.status).toBe('unknown');
      expect(allowsEntry(verdict)).toBe(false);
    }
  });
  test('future and incomplete candles do not enter the 30-day median', () => {
    const volumes = base().volumes;
    expect(median30At(volumes,asOf)).toBe(8_000_000);
    expect(median30At([...volumes,{ts:Math.floor(asOf/DAY)*DAY,quoteVolume:1}],asOf)).toBe(8_000_000);
    expect(median30At(volumes.slice(0,29),asOf)).toBeNull();
    expect(median30At([volumes[0]!,...volumes.slice(2)],asOf)).toBeNull();
    expect(median30At(volumes.map(v => ({...v,ts:v.ts-DAY})),asOf)).toBeNull();
  });
  test('USD anchor + cross prices detect depeg thresholds without live reallocation', () => {
    const anchor = {eurUsd:1.1,eurUsdt:1.1,usdcUsdt:1,fdusdUsdt:1};
    expect(assessQuote('USDC',anchor,config).ok).toBe(true);
    expect(assessQuote('USDC',{...anchor,usdcUsdt:.994},config).ok).toBe(false);
    expect(assessQuote('USDC',{...anchor,usdcUsdt:.979},config).reasons.join(' ')).toContain('nur Hinweis/Paper');
    expect(assessQuote('USDT',{...anchor,eurUsdt:1.11},config).ok).toBe(false);
    expect(assessQuote('USDT',{...anchor,eurUsd:null},config).ok).toBe(false);
    expect(evaluateQuality(base(),asOf,config,{ok:false,deviationBps:90,reasons:['Depeg']}).status).toBe('unknown');
  });
  test('terminal settlement is ex-post and uses last known close only', () => {
    expect(archiveTerminalSettlement(100,10).price).toBe(90);
    expect(settleTerminalArchivePosition([{ts:0,close:100,open:100,high:100,low:100,volume:1},
      {ts:DAY,close:1,open:1,high:1,low:1,volume:1}],DAY,10)?.fill).toBe(90);
    expect(settleTerminalArchivePosition([{ts:DAY,close:1,open:1,high:1,low:1,volume:1}],DAY,10)).toBeNull();
  });
});

describe('offline adapters and source failures', () => {
  const temporary: string[] = [];
  afterEach(async () => {await Promise.all(temporary.splice(0).map(path => rm(path,{recursive:true,force:true})));});
  async function store() {const dir = await mkdtemp(join(tmpdir(),'quality-test-'));temporary.push(dir);return new QualityStore(dir);}
  test('recent spread requires multiple independent observations', async () => {
    const storage = await store();
    expect(await storage.observeSpread('BTCUSDT',asOf,10)).toBeNull();
    expect(await storage.observeSpread('BTCUSDT',asOf+1000,200)).toBeNull();
    expect(await storage.observeSpread('BTCUSDT',asOf+60_000,12)).toBeNull();
    expect(await storage.observeSpread('BTCUSDT',asOf+120_000,20)).toBe(12);
  });
  test('archive ignores later status/snapshot and future bars', async () => {
    const storage = await store();
    await storage.record({asOf,profile:'normal',quote:'USDT',
      inputs:[base()],prices:{eurUsd:1.1,eurUsdt:1.1,usdcUsdt:1,fdusdUsdt:1},
      quoteHealth:healthy,feeds:{tags:feed(),delistings:feed()},
      verdicts:[evaluateQuality(base(),asOf,config,healthy)]});
    const candles = base().volumes.map(v => ({
      ts:v.ts,open:1,high:1,low:1,close:1,volume:1,quoteVolume:v.quoteVolume,
    })).concat([{ts:asOf+DAY,open:1,high:1,low:1,close:1,volume:1,quoteVolume:9e10}]);
    const source: CandleSource = {
      async getCandles(){return candles;},async listSymbols(){return ['BTCUSDT'];},
    };
    const archive = new ArchiveCoinQualityProvider(source,storage);
    const before = await archive.check('BTCUSDT',asOf-DAY);
    expect(before.status).toBe('unknown'); // NO later tags/exchangeInfo from today's snapshot
    const at = await archive.check('BTCUSDT',asOf);
    expect(at.sources.every(s => s.fetchedAt <= asOf)).toBe(true);
    expect(at.status).not.toBe('exit');
  });
  test('unofficial tag and delisting fixtures preserve positive warnings and source coverage', async () => {
    const fake = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('get-products')) return Response.json({data:[
        {s:'BTCUSDT',tags:['Monitoring']},{s:'ETHUSDT',tags:[]},
      ]});
      if (url.includes('article/list/query')) return Response.json({data:{
        catalogs:[{articles:[{title:'Binance Will Delist ETHUSDT Spot Trading Pair'}]}],
      }});
      return new Response('',{status:503});
    }) as typeof fetch;
    const source = new QualityPublicSources(fake,()=>asOf);
    const tags = await source.monitoringTags(['BTCUSDT','ETHUSDT']);
    expect(tags.available).toBe(true);
    expect(tags.clearForAll).toBe(true);
    expect(tags.symbols).toContain('BTCUSDT');
    const delist = await source.delistingAnnouncements(['ETHUSDT']);
    expect(delist.clearForAll).toBe(true);
    expect(delist.symbols).toContain('ETHUSDT');
  });
  test('invalid unofficial response cannot be interpreted as absence of tags', async () => {
    const fake = (async () => new Response('{}',{status:200})) as typeof fetch;
    const source = new QualityPublicSources(fake,()=>asOf);
    await expect(source.monitoringTags(['BTCUSDT'])).rejects.toThrow();
    await expect(source.delistingAnnouncements(['BTCUSDT'])).rejects.toThrow();
    await expect(source.exchangeInfo()).rejects.toThrow();
  });
  test('failed source attempt is persisted and throttled, offline only', async () => {
    const storage = await store();
    let current = asOf;
    let tagRequests = 0;
    const fake = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('get-products')) {tagRequests++;return new Response('',{status:503});}
      if (url.includes('exchangeInfo')) return Response.json({symbols:[{
        symbol:'BTCUSDT',status:'TRADING',baseAsset:'BTC',quoteAsset:'USDT',
        isSpotTradingAllowed:true,orderTypes:['MARKET'],filters:[],
      }]});
      if (url.includes('/api/v3/klines')) {
        if (url.includes('startTime')) return Response.json([[
          asOf-130*DAY,'1','1','1','1','1',asOf-129*DAY,'1',
        ]]);
        return Response.json(base().volumes.map(v => [v.ts,'1','1','1','1','1',v.ts+DAY-1,String(v.quoteVolume)]));
      }
      if (url.includes('bookTicker')) return Response.json({bidPrice:'100',askPrice:'100.1'});
      if (url.includes('ticker/price')) return Response.json({price:url.includes('EURUSDT')?'1.1':'1'});
      if (url.includes('eurofxref')) return new Response("<Cube currency='USD' rate='1.1'/>");
      return new Response('{}');
    }) as typeof fetch;
    const provider = new LiveCoinQualityProvider(config,new QualityPublicSources(fake,()=>current),storage,()=>current);
    expect((await provider.check('BTCUSDT',current)).status).toBe('unknown');
    current += 10*60_000;
    expect((await provider.check('BTCUSDT',current)).status).toBe('unknown');
    expect(tagRequests).toBe(1); // includes failure, even across check calls
    expect((await storage.readSource('tags'))?.lastError).toContain('HTTP 503');
    const report = await storage.latest();
    expect(report?.verdicts[0]?.status).toBe('unknown');
    expect(await readFile(join(storage.directory,'decisions.ndjson'),'utf8')).toContain('BTCUSDT');
  });
});
