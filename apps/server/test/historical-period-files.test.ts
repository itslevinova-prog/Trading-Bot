import {test,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';import {gzipSync} from 'node:zlib';
import {digest} from '../src/provenance/build.js';import {canonicalJson} from '../src/research/dataset.js';import {historicalPeriodPlan,strictHistoricalPage} from '../src/research/historical-period.js';
// @ts-expect-error JavaScript CLI module shares the built pure validators.
import {writeImmutableCompressed,loadHistoricalPeriod,pageFile,marketFile,readCompressed,historyStudySelection,validateHistoryStudyPeriods,verifyHistoryStrategyModules} from '../../../scripts/historical-period-files.mjs';
const pair='BTC/EUR',period={id:'2026-01',fromTs:Date.UTC(2026,0,1),toExclusive:Date.UTC(2026,1,1),warmupDays:8};
function fixture(){const root=mkdtempSync(join(tmpdir(),'paper-history-test-'));const config={root,protocolHash:'fixture',protocol:{periods:[period],symbols:[pair],metadata:[{symbol:pair,lotDecimals:6,ordermin:.000001,costmin:5}],selection:'fixture'},source:{options:{startingBalance:1000}}},plan=historicalPeriodPlan(period),pages:any[]=[],rows:any[]=[];
 for(let offset=0;offset<plan.expectedBars;offset+=1000){const from=plan.fromWithWarmup+offset*900000,toInclusive=period.toExclusive-1,raw=Array.from({length:Math.min(1000,plan.expectedBars-offset)},(_,i)=>{const ts=from+i*900000;return [ts,'100','101','99','100','10',ts+899999];}),page={protocolHash:'fixture',pair,from,toInclusive,raw,canonicalRawHash:digest(canonicalJson(raw))};writeImmutableCompressed(pageFile(config,period,pair,from,toInclusive),page);pages.push({from,toInclusive,canonicalRawHash:page.canonicalRawHash});rows.push(...strictHistoricalPage(pair,from,toInclusive,period.toExclusive,raw));}
 const document={protocolHash:'fixture',pair,period,repair:{complete:true},pages,rows},file=marketFile(config,period,pair);writeImmutableCompressed(file,document);
 return {config,document,file,cleanup:()=>{if(!resolve(root).startsWith(resolve(tmpdir())+sep+'paper-history-test-'))throw Error('Unsafe fixture path');rmSync(root,{recursive:true,force:true});}};
}
test('all loaded replay prices are reconstructed from the original checksum-bound public pages',()=>{const f=fixture();try{expect(loadHistoricalPeriod(f.config,period.id).markets[0].candles).toHaveLength(3744);f.config.protocol.symbols.push('ETH/EUR');expect(()=>loadHistoricalPeriod(f.config,period.id)).toThrow();}finally{f.cleanup();}});
test('valid-looking normalized price tampering cannot diverge from the source archive',()=>{const f=fixture();try{f.document.rows[0].close=100.5;writeFileSync(f.file,gzipSync(canonicalJson(f.document)));expect(()=>loadHistoricalPeriod(f.config,period.id)).toThrow('Normalized historical prices differ');}finally{f.cleanup();}});
test('changed public source bytes fail their hash rather than silently becoming a new historical truth',()=>{const f=fixture();try{const ref=f.document.pages[0],path=pageFile(f.config,period,pair,ref.from,ref.toInclusive),p=readCompressed(path);p.raw[0][4]='100.5';writeFileSync(path,gzipSync(canonicalJson(p)));expect(()=>loadHistoricalPeriod(f.config,period.id)).toThrow();}finally{f.cleanup();}});

test('history study selectors allow only fixed project paths and independent capped namespaces',()=>{
 const original=historyStudySelection(),training=historyStudySelection('training-pre-april');expect(training.directory).not.toBe(original.directory);expect(training.protocolFile).not.toBe(original.protocolFile);for(const unknown of ['../training','__proto__','constructor','training-pre-april/../../'])expect(()=>historyStudySelection(unknown)).toThrow('Unknown registered history study');
});
test('training registration excludes April and July and cannot quietly drop unsuccessful months',()=>{
 const ids=historyStudySelection('training-pre-april').periods,periods=ids.map((id:string)=>{const year=Number(id.slice(0,4)),month=Number(id.slice(5,7));return {id,fromTs:Date.UTC(year,month-1,1),toExclusive:Date.UTC(year,month,1),warmupDays:8};});expect(()=>validateHistoryStudyPeriods({periods},'training-pre-april')).not.toThrow();expect(()=>validateHistoryStudyPeriods({periods:periods.slice(1)},'training-pre-april')).toThrow('Registered study periods changed');expect(()=>validateHistoryStudyPeriods({periods:[...periods,{...period,id:'2026-07'}]},'training-pre-april')).toThrow();const overlapping=structuredClone(periods);overlapping[4].toExclusive=Date.UTC(2026,3,2);expect(()=>validateHistoryStudyPeriods({periods:overlapping},'training-pre-april')).toThrow('Training cannot overlap');
});

test('post-April evidence namespace fixes only May and keeps later months inaccessible',()=>{
 const selection=historyStudySelection('evidence-post-april');expect(selection.periods).toEqual(['2026-05']);expect(selection.directory).not.toBe(historyStudySelection().directory);
 const registration={periods:[{id:'2026-05',fromTs:Date.UTC(2026,4,1),toExclusive:Date.UTC(2026,5,1),warmupDays:8}],periodRoles:{'2026-05':'validation-source-only'}};
 expect(()=>validateHistoryStudyPeriods(registration,'evidence-post-april')).not.toThrow();
 for(const month of ['2026-06','2026-07'])expect(()=>validateHistoryStudyPeriods({...registration,periods:[{...registration.periods[0],id:month}]},'evidence-post-april')).toThrow('Registered study periods changed');
 for(const field of ['fromTs','toExclusive','warmupDays'] as const){const changed=structuredClone(registration);changed.periods[0]![field]+=field==='warmupDays'?1:86400000;expect(()=>validateHistoryStudyPeriods(changed,'evidence-post-april')).toThrow();}
 expect(()=>validateHistoryStudyPeriods({...registration,periodRoles:{'2026-05':'training'}},'evidence-post-april')).toThrow('Evidence role changed');
});


test('evidence can pin exactly the shared risk module without opening arbitrary broker paths',()=>{
 const project=resolve('../..'),hash=digest(readFileSync(join(project,'apps/server/dist/broker/risk.js')));
 expect(()=>verifyHistoryStrategyModules(project,{'broker/risk.js':hash})).not.toThrow();
 expect(()=>verifyHistoryStrategyModules(project,{'broker/risk.js':'0'.repeat(64)})).toThrow('Registered strategy changed');
 for(const module of ['broker/other.js','broker/../risk.js','../broker/risk.js','broker/risk.js/../../config.js'])expect(()=>verifyHistoryStrategyModules(project,{[module]:hash})).toThrow('Unexpected registered module path');
});
