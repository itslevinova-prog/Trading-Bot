import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {initPositionEntries,recordPositionEntry,positionEntryEvidence} from '../src/context/position-entry.js';
const now=Date.UTC(2026,9,31,18,45,5),fill={id:'T1',accountId:'ai',pair:'ETH/EUR',decisionId:'D1',qty:1,fillPrice:100,costEur:100,feeEur:.1,ts:now},position={id:'P1',accountId:'ai',pair:'ETH/EUR',qty:1,openedAt:now},order={accountId:'ai',pair:'ETH/EUR',side:'buy' as const,amountEur:100.1,reason:'Recorded entry explanation',decisionId:'D1',stopLossPct:.02,takeProfitPct:.04};
function fixture(){
 const sql=new Database(':memory:');sql.pragma('foreign_keys=ON');sql.exec('CREATE TABLE trades(id TEXT PRIMARY KEY);CREATE TABLE decisions(id TEXT PRIMARY KEY,account_id TEXT,provider TEXT,ts INTEGER,status TEXT,context_json TEXT,actions_json TEXT);CREATE TABLE decision_evidence(decision_id TEXT PRIMARY KEY,evidence_json TEXT,recorded_at INTEGER);');initPositionEntries(sql);
 const feature={pair:'ETH/EUR',ts:now-905000,price:100},structure={version:'closed-structure-v1',complete:true,signalClosedAt:now-5000,priorSupport:98,priorResistance:101};
 const ctx={timeUTC:new Date(now-500).toISOString(),account:{id:'ai'},execution:{mode:'paper',evaluationVersion:'V1'},features:[feature],marketContext:{markets:[{pair:'ETH/EUR',asOf:now-500,feature:{...feature},quality:{stale:false,bookUsable:true,bookAgeMs:0,lastClosedAt:now-5000},regime:{structure}}]}},assessment={pair:'ETH/EUR',action:'buy',strategy:'trend-continuation',invalidation:'Trendverlust oder Stop',support:['closed-path-shows-directional-movement'],contradictions:[]},evidence={version:'structure-exit-paper-v1',assessments:[assessment]};
 sql.prepare('INSERT INTO trades VALUES (?)').run(fill.id);sql.prepare('INSERT INTO decisions VALUES (?,?,?,?,?,?,?)').run('D1','ai','mock:structure-exit-v1',now-500,'validated',JSON.stringify(ctx),JSON.stringify([{...order,type:'buy',reasoning:order.reason}]));sql.prepare('INSERT INTO decision_evidence VALUES (?,?,?)').run('D1',JSON.stringify(evidence),now-100);
 return {sql,ctx,evidence};
}
function record(sql:Database.Database){recordPositionEntry(sql,fill,'P1','open',order,'V1');return positionEntryEvidence(sql,position,Date.now()+1000,'V1');}
test('atomically linked opening preserves original structured assessment and original support',()=>{
 const {sql}=fixture();try{const r=record(sql);expect(r).toMatchObject({originalStrategyAssessmentObserved:true,eligibleForThesisPolicy:true,recordedEntries:1,scaleInCount:0,initialEntry:{sourceObserved:true,scopeMatched:true,recordedStructure:{priorSupport:98},structuredAssessment:{strategy:'trend-continuation'}}});expect(r.initialEntry!.sourceContextHash).toMatch(/^[a-f0-9]{64}$/);}finally{sql.close();}
});
test('subsequent decision/evidence mutation cannot rewrite captured entry knowledge',()=>{
 const {sql}=fixture();try{const first=record(sql);sql.exec(`UPDATE decisions SET context_json='{}',actions_json='[]';UPDATE decision_evidence SET evidence_json='{}',recorded_at=9999999999999;`);expect(positionEntryEvidence(sql,position,Date.now()+1000,'V1')).toEqual(first);expect(()=>recordPositionEntry(sql,fill,'P1','open',order,'V1')).toThrow();}finally{sql.close();}
});
test.each(['missing-decision','postfill-decision','wrong-owner','prepared','action-mismatch','duplicate-action','future-context','wrong-mode'] as const)('%s cannot manufacture original decision knowledge',kind=>{
 const {sql,ctx}=fixture();try{
 if(kind==='missing-decision')sql.exec('DELETE FROM decisions');if(kind==='postfill-decision')sql.prepare('UPDATE decisions SET ts=?').run(now+1);if(kind==='wrong-owner')sql.exec("UPDATE decisions SET account_id='other'");if(kind==='prepared')sql.exec("UPDATE decisions SET status='prepared'");
 if(kind==='action-mismatch')sql.prepare('UPDATE decisions SET actions_json=?').run(JSON.stringify([{type:'buy',pair:'ETH/EUR',amountEur:999}]));
 if(kind==='duplicate-action')sql.prepare('UPDATE decisions SET actions_json=?').run(JSON.stringify(Array(2).fill({type:'buy',pair:'ETH/EUR'})));
 if(kind==='future-context'){ctx.timeUTC=new Date(now+1).toISOString();sql.prepare('UPDATE decisions SET context_json=?').run(JSON.stringify(ctx));}
 if(kind==='wrong-mode'){ctx.execution.mode='live';sql.prepare('UPDATE decisions SET context_json=?').run(JSON.stringify(ctx));}
 const r=record(sql);expect(r.eligibleForThesisPolicy).toBe(false);expect(r.originalStrategyAssessmentObserved).toBe(false);expect(r.initialEntry!.reasons.length).toBeGreaterThan(0);
 }finally{sql.close();}
});
test.each(['postfill-evidence','missing-evidence','contradiction','duplicate-assessment','wrong-scope','future-structure','mixed-feature','stale-book'] as const)('%s keeps original explanation separate from a usable structural thesis',kind=>{
 const {sql,ctx,evidence}=fixture();try{
 if(kind==='postfill-evidence')sql.prepare('UPDATE decision_evidence SET recorded_at=?').run(now+1);if(kind==='missing-evidence')sql.exec('DELETE FROM decision_evidence');
 if(kind==='contradiction'){evidence.assessments[0]!.contradictions.push('veto' as never);sql.prepare('UPDATE decision_evidence SET evidence_json=?').run(JSON.stringify(evidence));}
 if(kind==='duplicate-assessment'){evidence.assessments.push(evidence.assessments[0]!);sql.prepare('UPDATE decision_evidence SET evidence_json=?').run(JSON.stringify(evidence));}
 if(kind==='wrong-scope'){ctx.execution.evaluationVersion='OTHER';sql.prepare('UPDATE decisions SET context_json=?').run(JSON.stringify(ctx));}
 if(kind==='mixed-feature'){ctx.marketContext.markets[0]!.feature.price=999;sql.prepare('UPDATE decisions SET context_json=?').run(JSON.stringify(ctx));}
 if(kind==='stale-book'){ctx.marketContext.markets[0]!.quality.bookAgeMs=5001;sql.prepare('UPDATE decisions SET context_json=?').run(JSON.stringify(ctx));}
 if(kind==='future-structure'){ctx.marketContext.markets[0]!.regime.structure.signalClosedAt=now+900000;sql.prepare('UPDATE decisions SET context_json=?').run(JSON.stringify(ctx));}
 const r=record(sql);expect(r.eligibleForThesisPolicy).toBe(false);expect(r.initialEntry!.sourceObserved).toBe(true);expect(r.initialEntry!.actionExplanation).toBe(order.reason);
 }finally{sql.close();}
});
test('legacy position has unknown opening; a new scale-in must not masquerade as its origin',()=>{
 const {sql}=fixture();try{expect(positionEntryEvidence(sql,position,Date.now()+1000,'V1')).toMatchObject({eligibleForThesisPolicy:false,reason:'original-opening-link-unavailable'});recordPositionEntry(sql,fill,'P1','scale-in',order,'V1');expect(positionEntryEvidence(sql,position,Date.now()+1000,'V1')).toMatchObject({originalStrategyAssessmentObserved:false,reason:'original-opening-link-unavailable'});}finally{sql.close();}
});
test('partial sale retains known original origin; same-pair reentry has a different position identity',()=>{
 const {sql}=fixture();try{record(sql);expect(positionEntryEvidence(sql,{...position,qty:.4},Date.now()+1000,'V1').eligibleForThesisPolicy).toBe(true);expect(positionEntryEvidence(sql,{...position,id:'P2'},Date.now()+1000,'V1').initialEntry).toBeNull();expect(positionEntryEvidence(sql,{...position,qty:1.1},Date.now()+1000,'V1').eligibleForThesisPolicy).toBe(false);}finally{sql.close();}
});
test('scale-ins are compound hypotheses rather than silently extending the original thesis',()=>{
 const {sql}=fixture();try{record(sql);sql.exec("INSERT INTO trades VALUES ('T2')");recordPositionEntry(sql,{...fill,id:'T2',ts:now+10},'P1','scale-in',order,'V1');expect(positionEntryEvidence(sql,{...position,qty:2},Date.now()+1000,'V1')).toMatchObject({originalStrategyAssessmentObserved:true,eligibleForThesisPolicy:false,scaleInCount:1,reason:'compound-scale-in-theses-not-one-position-thesis'});}finally{sql.close();}
});
test('missing fill, corrupted snapshot, mismatched owner and future observation are not trusted',()=>{
 const {sql}=fixture();try{expect(()=>recordPositionEntry(sql,{...fill,id:'MISSING'},'P1','open',order,'V1')).toThrow();record(sql);expect(positionEntryEvidence(sql,{...position,accountId:'other'},Date.now()+1000,'V1').eligibleForThesisPolicy).toBe(false);expect(positionEntryEvidence(sql,position,now-1).eligibleForThesisPolicy).toBe(false);sql.exec("UPDATE position_entry_evidence SET snapshot_json='{}'");expect(positionEntryEvidence(sql,position,Date.now()+1000,'V1')).toMatchObject({reason:'entry-snapshot-invalid-mixed-or-not-yet-observed',eligibleForThesisPolicy:false});}finally{sql.close();}
});
test('a failed surrounding fill transaction leaves no entry snapshot or fake executed origin',()=>{
 const {sql}=fixture();try{expect(()=>sql.transaction(()=>{record(sql);throw Error('rollback');})()).toThrow('rollback');expect(sql.prepare('SELECT count(*) AS n FROM position_entry_evidence').get()).toEqual({n:0});}finally{sql.close();}
});

test('historical simulated context stays distinguished from runtime observations in the retained entry',()=>{
 const {sql,ctx}=fixture();try{(ctx.execution as Record<string,unknown>).simulation={kind:'ohlc-next-open-synthetic-book-v1'};sql.prepare('UPDATE decisions SET context_json=?').run(JSON.stringify(ctx));expect(record(sql).initialEntry).toMatchObject({contextDomain:'historical-simulation',sourceExecution:{simulation:{kind:'ohlc-next-open-synthetic-book-v1'}}});}finally{sql.close();}
});

test('a different current evaluation scope cannot promote an older recorded thesis',()=>{
 const {sql}=fixture();try{record(sql);expect(positionEntryEvidence(sql,position,Date.now()+1000,'V2')).toMatchObject({originalStrategyAssessmentObserved:true,eligibleForThesisPolicy:false,reason:'entry-scope-differs-from-current-policy'});expect(positionEntryEvidence(sql,position,Date.now()+1000).eligibleForThesisPolicy).toBe(false);}finally{sql.close();}
});
