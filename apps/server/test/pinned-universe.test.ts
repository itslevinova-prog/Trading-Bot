import {test,expect} from 'vitest';
import {parseFixedPairs,selectBinanceUniverse,type PublicPairTicker} from '../src/market/pinned-universe.js';
import type {BinanceSymbol} from '../src/market/binance-data.js';import {Env} from '../src/config.js';
import {sanitisedTradingConfig,createRuntimeProvenance} from '../src/provenance/build.js';
const symbol=(base:string):BinanceSymbol=>({symbol:base+'EUR',baseAsset:base,quoteAsset:'EUR',baseAssetPrecision:8,quoteAssetPrecision:8,status:'TRADING',isSpotTradingAllowed:true,orderTypes:['MARKET','LIMIT'],filters:[{filterType:'LOT_SIZE',stepSize:'.001',minQty:'.001'},{filterType:'PRICE_FILTER',tickSize:'.01'},{filterType:'MIN_NOTIONAL',minNotional:'5'}]});
const tick=(base:string,volume=10):PublicPairTicker=>({symbol:base+'EUR',quoteVolume:String(volume),bidPrice:'100',askPrice:'100.01',lastPrice:'100',volume:'1',priceChangePercent:'-1'});
const symbols=()=>['BTC','ETH','SOL','ADA'].map(symbol),ticks=()=>[tick('BTC',10),tick('ETH',100),tick('SOL',200),tick('ADA',5)];
const options={quote:'EUR',topN:2,held:[] as string[],fixed:['BTC/EUR','ETH/EUR']};
test('canonical fixed lists are unique uppercase explicit pairs; reorder/whitespace canonicalizes',()=>{expect(parseFixedPairs(' ["ETH/EUR", "BTC/EUR"] ')).toEqual(['BTC/EUR','ETH/EUR']);expect(parseFixedPairs('')).toEqual([]);});
test.each(['[]','["BTC/EUR","BTC/EUR"]','["btc/EUR"]','["BTC/GBP"]','[" BTC/EUR"]','{}','[null]','[1]','not-json'])('invalid fixed list %s fails explicitly',raw=>expect(()=>parseFixedPairs(raw)).toThrow());
test('volume reversal/new top asset does not replace registered members or change deterministic order',()=>{
 const a=selectBinanceUniverse(symbols(),ticks(),options),updated=ticks();updated[1]!.quoteVolume='0';updated[2]!.quoteVolume='999999';const b=selectBinanceUniverse(symbols().reverse(),updated.reverse(),options);
 expect(a.map(x=>x.s.symbol)).toEqual(['BTCEUR','ETHEUR']);expect(b.map(x=>x.s.symbol)).toEqual(['BTCEUR','ETHEUR']);expect(b[1]!.t!.quoteVolume).toBe('0');
});
test('normal empty-pin mode preserves volume ranking, BTC inclusion and held-market retention',()=>{
 expect(selectBinanceUniverse(symbols(),ticks(),{...options,topN:1,fixed:[],held:['ADA/EUR']}).map(x=>x.s.symbol)).toEqual(['SOLEUR','BTCEUR','ADAEUR']);
});
test.each(['halted','spot-unknown','no-market-order','missing-symbol','missing-ticker','empty-ticker','duplicate-symbol','duplicate-ticker','unknown-lot','unsupported-step','missing-notional'] as const)('%s cannot silently drop/replace pinned assets',kind=>{
 const info=symbols(),ts=ticks(),eth=info[1]!;
 if(kind==='halted')eth.status='BREAK';if(kind==='spot-unknown')delete eth.isSpotTradingAllowed;if(kind==='no-market-order')eth.orderTypes=['LIMIT'];if(kind==='missing-symbol')info.splice(1,1);if(kind==='missing-ticker')ts.splice(1,1);if(kind==='empty-ticker')ts[1]!.volume='';if(kind==='duplicate-symbol')info.push({...eth});if(kind==='duplicate-ticker')ts.push({...ts[1]!});if(kind==='unknown-lot')eth.filters=eth.filters.filter(f=>f.filterType!=='LOT_SIZE');if(kind==='unsupported-step')eth.filters[0]!.stepSize='.005';if(kind==='missing-notional')eth.filters=eth.filters.filter(f=>f.filterType!=='MIN_NOTIONAL');expect(()=>selectBinanceUniverse(info,ts,options)).toThrow();
});
test('fresh exchange limit changes remain visible to downstream contract drift checks',()=>{
 const info=symbols(),a=selectBinanceUniverse(info,ticks(),options),fresh=structuredClone(info);fresh[1]!.filters[0]!.minQty='.01';const b=selectBinanceUniverse(fresh,ticks(),options);expect(b[1]!.s.filters[0]!.minQty).toBe('.01');expect(a[1]!.s.filters[0]!.minQty).toBe('.001');
});
test.each([{...options,held:['SOL/EUR']},{...options,fixed:['ETH/EUR']},{...options,fixed:['BTC/USDT','ETH/USDT']}])('held/benchmark/quote mismatch fails before caller database writes',o=>expect(()=>selectBinanceUniverse(symbols(),ticks(),o)).toThrow('mismatch'));
const profile={PAPER_FIXED_PAIRS:'["ETH/EUR","BTC/EUR"]',TOP_N_PAIRS:2,PAPER_EXPERIMENT_MODE:'mock',AI_PROVIDER:'mock',AI_ENABLED:'false',AI_ALLOW_REMOTE:'false',AI_API_KEY:'',ANTHROPIC_API_KEY:'',EXCHANGE:'binance',QUOTE_CURRENCY:'EUR',DATABASE_PATH:'./data/mock-experiment.db'};
test('configuration canonicalizes and fingerprints the registered fixed universe',()=>{
 const a=Env.parse(profile),b=Env.parse({...profile,PAPER_FIXED_PAIRS:'["BTC/EUR", "ETH/EUR"]'});expect(a.PAPER_FIXED_PAIRS).toBe('["BTC/EUR","ETH/EUR"]');expect(a.PAPER_FIXED_PAIRS).toBe(b.PAPER_FIXED_PAIRS);expect(sanitisedTradingConfig(a).PAPER_FIXED_PAIRS).toBe(a.PAPER_FIXED_PAIRS);
 const build={verified:true,buildId:'a'.repeat(64),builtAt:'fixture',sourceFiles:1,runtimeFiles:1,reasons:[]};expect(createRuntimeProvenance(build,a).configurationFingerprint).toBe(createRuntimeProvenance(build,b).configurationFingerprint);
});
test.each([{...profile,PAPER_EXPERIMENT_MODE:'off'},{...profile,DATABASE_PATH:'./data/binance-eur-paper.db'},{...profile,TOP_N_PAIRS:20},{...profile,QUOTE_CURRENCY:'USDT'},{...profile,AI_ENABLED:'true'},{...profile,AI_ALLOW_REMOTE:'true'},{...profile,AI_API_KEY:'forbidden'},{...profile,EXCHANGE:'kraken'}])('unsafe or mismatched fixed-universe profile is rejected',p=>expect(Env.safeParse(p).success).toBe(false));
