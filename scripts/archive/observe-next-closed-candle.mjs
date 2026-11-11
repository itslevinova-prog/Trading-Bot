import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {writeFileSync} from 'node:fs';
const get=async path=>{const r=await fetch('http://127.0.0.1:3000'+path,{signal:AbortSignal.timeout(10000),redirect:'error'});assert.equal(r.status,200);return r.json();};
const p=await get('/api/provenance'),context=await get('/api/context');assert.equal(p.verified,true);assert.equal(p.tradingConfig.AI_PROVIDER,'none');assert.equal(p.tradingConfig.PAPER_EXPERIMENT_MODE,'off');
const started=Date.now(),targetClose=Math.floor(started/900000)*900000+900000,deadline=performance.now()+Math.min(960000,targetClose-started+45000);
const pairs=context.markets.map(m=>m.pair);assert.equal(pairs.length,20);
const require=createRequire(new URL('../apps/server/package.json',import.meta.url)),Database=require('better-sqlite3'),db=new Database('data/binance-eur-paper.db',{readonly:true,fileMustExist:true});
const stmt=db.prepare('SELECT pair,max(ts)+900000 lastClose FROM candles WHERE interval=15 AND pair IN ('+pairs.map(()=>'?').join(',')+') GROUP BY pair');
const report={startedAt:new Date(started).toISOString(),targetClose,buildId:p.build.buildId,runId:p.runId,observations:[],status:'observing',developmentTimeCredited:0,scope:'Actual stored public candle availability; no orders/providers, no reconstructed receipt times or independent samples'};
const save=()=>writeFileSync('docs/next-closed-candle-observation.json',JSON.stringify(report,null,2));
try{save();while(performance.now()<deadline){const now=Date.now(),rows=stmt.all(...pairs),byPair=new Map(rows.map(r=>[r.pair,r.lastClose]));
 const future=pairs.filter(pair=>byPair.get(pair)>now),missing=pairs.filter(pair=>!(byPair.get(pair)>=targetClose)),sample={at:now,completeMarkets:pairs.length-missing.length,missing,future};
 if(now>=targetClose-2000||report.observations.length===0){report.observations.push(sample);save();}
 if(future.length){report.status='future-stored-candle-detected';break;}
 if(!missing.length){report.status='observed-current-close';break;}
 await new Promise(resolve=>setTimeout(resolve,1000));}
 if(report.status==='observing')report.status='missing-current-close-at-deadline';report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,targetClose,buildId:report.buildId,last:report.observations.at(-1)}));
}finally{db.close();}
