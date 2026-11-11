import {expect,test} from 'vitest';
import Database from 'better-sqlite3';
import type {FeatureSnapshot} from '@paper/shared';
import {compressMemoryRecords,readPackedMemoryRecord} from '../src/ai/intent-encoding.js';
import {initMemoryTables,PaperMemoryStore} from '../src/memory/store.js';
const step=900000,hour=3600000,base=Date.UTC(2026,8,1);
function fixture() {
 const sql=new Database(':memory:');sql.pragma('foreign_keys=ON');
 sql.exec(`CREATE TABLE memory_entries(id TEXT PRIMARY KEY,decision_id TEXT,account_id TEXT,pair TEXT,ts INTEGER,features_json TEXT,action TEXT,price_at_ts REAL,change_1h REAL,change_4h REAL,change_24h REAL,trade_pnl_eur REAL);
 CREATE TABLE candles(pair TEXT,interval INTEGER,ts INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,PRIMARY KEY(pair,interval,ts));`);
 initMemoryTables(sql);return {sql,store:new PaperMemoryStore(sql)};
}
function feature(close=base): FeatureSnapshot {return {pair:'ETH/EUR',ts:close-step,price:100,ema20:99,ema50:98,ema50_60m:97,prevEma20:99,prevEma50:98,rsi14:55,atr14:1,atrPct:1,volumeRatio:1.5,change1h:1,change4h:2,change24h:3,spreadPct:.01,distanceEma50Pct:2};}
function candle(sql:Database.Database,closeAt:number,price=110) {sql.prepare('INSERT INTO candles VALUES(?,?,?,?,?,?,?,?)').run('ETH/EUR',15,closeAt-step,price,price+1,price-1,price,10);}
function seed(store:PaperMemoryStore,close=base,account='ai',delay=1000) {store.save('fixture',account,[feature(close)],[{pair:'ETH/EUR',type:'buy'}],close+delay);}
const query=(store:PaperMemoryStore,asOf:number,account='ai')=>store.recall('ETH/EUR',feature(Math.floor(asOf/step)*step),asOf,account);

test('exact four-hour close and first actual recording time both gate recall',()=>{const {sql,store}=fixture();try {
 seed(store);candle(sql,base+4*hour);
 expect(store.backfill(base+4*hour-1)).toBe(0);
 expect(query(store,base+4*hour).hits).toEqual([]);
 expect(store.backfill(base+4*hour+5000)).toBe(1);
 expect(query(store,base+4*hour+4999).hits).toEqual([]);
 expect(query(store,base+4*hour+5000).hits[0]).toMatchObject({priceCloseTs:base,outcomeAvailableAt:base+4*hour+5000,change24h:null,tradePnlEur:null});
 expect(query(store,base+4*hour+5000).hits[0]!.change4h).toBeCloseTo(10);
}finally{sql.close();}});

test('nearby candles cannot replace missing exact outcome anchors',()=>{const {sql,store}=fixture();try {
 seed(store);candle(sql,base+4*hour-step);candle(sql,base+4*hour+step);
 expect(store.backfill(base+5*hour)).toBe(0);expect(query(store,base+5*hour).hits).toEqual([]);
}finally{sql.close();}});

test('future outcomes and extreme future vectors cannot change historical hits, scaling or evidence',()=>{const {sql,store}=fixture();try {
 seed(store);candle(sql,base+4*hour);store.backfill(base+4*hour);const asOf=base+5*hour,before=query(store,asOf);
 const future=feature(base+48*hour);future.rsi14=1e20;future.change1h=-1e25;
 store.save('future','ai',[future],[],base+48*hour+1000);candle(sql,base+52*hour,1e8);candle(sql,base+24*hour,1e6);store.backfill(base+52*hour);
 expect(query(store,asOf)).toEqual(before);
 expect(query(store,asOf).hits[0]!.change24h).toBeNull();
 expect(query(store,base+53*hour).hits.some(h=>h.change24h!==null)).toBe(true);
}finally{sql.close();}});

test('legacy values are preserved but cannot become verified outcomes, including unproven PnL',()=>{const {sql,store}=fixture();try {
 sql.prepare('INSERT INTO memory_entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('old','old','ai','ETH/EUR',base-10*hour,'[0,0,0,0,0,0,0,0]','sell',100,1,50,100,999);
 expect(query(store,base+5*hour)).toMatchObject({hits:[],evidence:{legacyRowsExcluded:1}});
 store.backfill(base+100*hour);
 expect(sql.prepare('SELECT change_4h,trade_pnl_eur FROM memory_entries WHERE id=?').get('old')).toEqual({change_4h:50,trade_pnl_eur:999});
}finally{sql.close();}});

test('same candle across repeated observations counts once and overlapping four-hour windows are filtered',()=>{const {sql,store}=fixture();try {
 seed(store);seed(store,base,'ai',2000);seed(store,base+hour);seed(store,base+4*hour);
 for(const close of [base,base+hour,base+4*hour])candle(sql,close+4*hour);
 store.backfill(base+9*hour);const result=query(store,base+10*hour);
 expect(result.evidence.duplicateWindowsExcluded).toBe(1);expect(result.evidence.overlapWindowsExcluded).toBe(1);
 expect(result.hits).toHaveLength(2);expect(Math.abs(result.hits[0]!.priceCloseTs-result.hits[1]!.priceCloseTs)).toBe(4*hour);
 expect(result.evidence).toMatchObject({independence:'unknown',estimatedWinProbability:null,performanceValidated:false});
}finally{sql.close();}});

test('account scope and malformed stored vectors are explicit and never silently zero-imputed',()=>{const {sql,store}=fixture();try {
 seed(store);seed(store,base+4*hour,'other');candle(sql,base+4*hour);candle(sql,base+8*hour);store.backfill(base+9*hour);
 expect(query(store,base+10*hour).hits).toHaveLength(1);
 sql.prepare("UPDATE memory_entries SET features_json='[1,null]' WHERE account_id='ai'").run();
 const r=query(store,base+10*hour);expect(r.hits).toEqual([]);expect(r.evidence.invalidVectorsExcluded).toBe(1);
 expect(query(store,base+10*hour,'other').hits).toHaveLength(1);
}finally{sql.close();}});

test('saving rejects unfinished, stale, unaligned and invalid-price observations atomically',()=>{const {sql,store}=fixture();try {
 for(const f of [{...feature(),ts:base},{...feature(),ts:base-step-1},{...feature(),price:NaN},feature(base-2*hour)])store.save('bad','ai',[f],[],base+1000);
 expect(sql.prepare('SELECT count(*) n FROM memory_entries').get()).toEqual({n:0});
 expect(()=>query(store,NaN)).toThrow();expect(()=>store.backfill(-1)).toThrow();
}finally{sql.close();}});

test('only closed, valid OHLCV outcomes persist; later backfill cannot rewrite evidence',()=>{const {sql,store}=fixture();try {
 seed(store);candle(sql,base+4*hour);sql.prepare('UPDATE candles SET high=1').run();expect(store.backfill(base+5*hour)).toBe(0);
 sql.prepare('UPDATE candles SET high=111').run();expect(store.backfill(base+6*hour)).toBe(1);const before=query(store,base+7*hour);
 sql.prepare('UPDATE candles SET close=109').run();expect(store.backfill(base+8*hour)).toBe(0);expect(query(store,base+7*hour)).toEqual(before);
}finally{sql.close();}});

test('memory timestamps, unavailable outcomes and changing evidence survive lossless context encoding',()=>{const {sql,store}=fixture();try {
 seed(store);candle(sql,base+4*hour);store.backfill(base+4*hour);
 const r=query(store,base+5*hour),memory=Array.from({length:20},(_,i)=>({...r,pair:`COIN${i}/EUR`,evidence:{...r.evidence,legacyRowsExcluded:i,normalizationRows:i+1}}));
 const c:any={memory:structuredClone(memory),transmission:{}};expect(compressMemoryRecords(c)).toBe(true);
 expect(c.memory.map((m:unknown)=>readPackedMemoryRecord(m,c))).toEqual(memory);
}finally{sql.close();}});
