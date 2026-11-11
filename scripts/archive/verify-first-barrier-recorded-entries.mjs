import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {historyCaptureConfig,loadHistoricalPeriod} from './historical-period-files.mjs';import {canonicalJson} from '../apps/server/dist/research/dataset.js';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=x=>createHash('sha256').update(x).digest('hex');
const pointer=read('docs/first-barrier-recorded-entries-latest.json'),report=read(pointer.path),{factsHash,generatedAt,...facts}=report;assert.equal(hash(canonicalJson(facts)),factsHash);assert.equal(pointer.hash,factsHash);
const original=historyCaptureConfig(process.cwd(),false),training=historyCaptureConfig(process.cwd(),false,'training-pre-april');let period,data,available=0,unavailable=0;
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-10*Math.max(1e-12,Math.abs(a),Math.abs(b)));
for(const row of report.rows){assert.notEqual(row.period,'2026-07');if(period!==row.period){period=row.period;data=loadHistoricalPeriod(['2026-01','2026-04'].includes(period)?original:training,period);assert.equal(hash(canonicalJson(data.markets)),row.target.dataScope);}
 const t=row.target,end=row.entryAt+32*900000,m=data.markets.find(m=>m.pair===row.pair),path=m.candles.filter(c=>c.ts>=row.entryAt&&c.ts<end).sort((a,b)=>a.ts-b.ts);
 assert.equal(t.horizonBars,32);
 if(path.length!==32||path.some((c,i)=>c.ts!==row.entryAt+i*900000)){assert.equal(row.outcome,null);unavailable++;continue;}
 const o=row.outcome;assert.ok(o);const fee=t.costs.feeRate,spread=t.costs.spreadBps/20000,slip=t.costs.slippageBps/10000;
 const fill=path[0].open*(1+spread)*(1+slip),basis=fill*(1+fee),stop=basis*(1-t.stopLossPct),target=fill*(1+t.takeProfitPct);
 near(o.entryFill,fill);near(o.entryBasis,basis);near(o.stopPrice,stop);near(o.targetPrice,target);assert.equal(o.availableAt,end);
 const first=path.find(c=>c.open<=stop||c.open>=target||c.low<=stop||c.high>=target);let kind,price,execution;
 if(!first){kind='timeout';price=path.at(-1).close;execution='horizon-close';}
 else if(first.open<=stop){kind='stop';price=first.open;execution='gap-open';}
 else if(first.open>=target){kind='target';price=target;execution='barrier';}
 else if(first.low<=stop&&first.high>=target){kind='ambiguous';price=null;execution='unknown-path';}
 else if(first.low<=stop){kind='stop';price=stop;execution='barrier';}
 else{kind='target';price=target;execution='barrier';}
 assert.equal(o.outcome,kind);assert.equal(o.execution,execution);assert.equal(o.eventBarTs,(first??path.at(-1)).ts);
 if(price===null){assert.equal(o.exitReference,null);assert.equal(o.netReturn,null);}else{near(o.exitReference,price);near(o.netReturn,price*(1-spread)*(1-slip)*(1-fee)/basis-1);}available++;
}
assert.equal(available+unavailable,269);const proof={verifiedAt:new Date().toISOString(),factsHash,rawRowsChecked:269,available,unavailable,firstEventOrderVerified:true,allCostedPayoffsVerified:true,modelFitted:false,portfolioPerformanceClaimed:false,julyLoaded:false};fs.writeFileSync('docs/first-barrier-recorded-entries-verification.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
