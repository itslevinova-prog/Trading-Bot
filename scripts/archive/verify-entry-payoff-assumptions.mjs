import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../apps/server/dist/research/dataset.js';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = x => createHash('sha256').update(x).digest('hex');
const near = (a,b) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) < 1e-10*Math.max(1e-12,Math.abs(a),Math.abs(b)), `${a} != ${b}`);
const pointer=read('docs/entry-payoff-audit-latest.json');
const audit=read(pointer.path), {factsHash,generatedAt,...facts}=audit;
assert.equal(hash(canonicalJson(facts)),factsHash); assert.equal(pointer.hash,factsHash);
const source=read(audit.report), {reportHash,generatedAt:sourceAt,...sourceFacts}=source;
assert.equal(hash(canonicalJson(sourceFacts)),reportHash); assert.equal(reportHash,audit.reportHash);
const geometry=read('docs/entry-payoff-price-geometry.json');
const {factsHash:geometryHash,observedAt,...geometryFacts}=geometry;
assert.equal(hash(canonicalJson(geometryFacts)),geometryHash);
const key = r => [r.period,r.fee,r.variant,r.pair,r.entryBarTs].join('|');
const indexed=new Map(audit.rows.map(r=>[key(r),r])); assert.equal(indexed.size,audit.rows.length);
const geometric=new Map(geometry.rows.map(r=>[key(r),r])); assert.equal(geometric.size,geometry.rows.length);
let checked=0; const floors={};
for(const scenario of source.scenarios) for(const variant of scenario.variants) for(const entry of variant.entryRecords.entries){
 assert.equal(hash(entry.snapshot_json),entry.snapshot_hash); assert.deepEqual(JSON.parse(entry.snapshot_json),entry.snapshot);
 const s=entry.snapshot, f=s.feature, a=s.structuredAssessment, p=a.payoff;
 const k=key({period:scenario.period,fee:scenario.fee,variant:variant.name,pair:entry.pair,entryBarTs:entry.fill_ts-5000});
 const r=indexed.get(k),g=geometric.get(k); assert.ok(r&&g);
 const fee=scenario.fee, slip=.0015;
 // Independent normalized cash-flow formulas; do not call paperPayoff or the audit runner.
 const reward=(1+a.target)*(1-slip)*(1-fee)/(1+fee)-1;
 const risk=1-(1-a.stop)*(1-slip)*(1-fee);
 near(p.netReward,reward); near(p.netRisk,risk); near(p.netRewardRisk,reward/risk);
 near(p.breakEvenRequiredWinRate,risk/(risk+reward));
 near(p.stopPrice,p.entryBasis*(1-a.stop)); near(p.targetPrice,p.entryFill*(1+a.target));
 near(p.entryBasis,p.entryFill*(1+fee));
 near(a.stop,Math.max(.02,2*f.atr14/f.price)); near(a.target,Math.min(.4,Math.max(.03,2*a.stop)));
 const basis=s.fill.fillPrice+s.fill.feeEur/s.fill.qty;
 near(s.fill.feeEur,s.fill.fillPrice*s.fill.qty*fee);
 near(g.actualStopDistanceAtr,(basis-s.appliedProtection.stopLossPrice)/f.atr14);
 near(g.actualTargetDistanceAtr,(s.appliedProtection.takeProfitPrice-s.fill.fillPrice)/f.atr14);
 near(g.requestedStopPctOverSignalAtrPct,a.stop*f.price/f.atr14);
 near(g.requestedTargetPctOverSignalAtrPct,a.target*f.price/f.atr14);
 near(r.conditionalNetRewardRisk,reward/risk);
 assert.equal(p.estimatedWinProbability,null); assert.equal(p.expectedValue,null);
 assert.equal(r.stopFloorBinding,2*f.atr14/f.price<.02);
 if(fee===.001){floors[variant.name]??={entries:0,binding:0};floors[variant.name].entries++;floors[variant.name].binding+=Number(r.stopFloorBinding);}
 indexed.delete(k);geometric.delete(k);checked++;
}
assert.equal(indexed.size,0);assert.equal(geometric.size,0);assert.equal(checked,269);
for(const [name,v] of Object.entries(floors)){assert.equal(v.entries,audit.groups[name].entries);assert.equal(v.binding,audit.groups[name].stopFloorBinding);}
const proof={version:'entry-payoff-independent-verification-v1',verifiedAt:new Date().toISOString(),factsHash,geometryHash,checkedRows:checked,normalizedCashFlowsVerified:true,snapshotSerializedIdentityVerified:true,actualFeeLedgerGeometryVerified:true,floors,testsPassed:9,sourceStrategyChanged:false,probabilityEstimated:false,profitabilityEstablished:false};
writeFileSync('docs/entry-payoff-verification.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
