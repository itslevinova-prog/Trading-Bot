import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {dcaPeriod,loadPaperDcaSettings,initPaperDcaLedger,depositPaperCash,
 reservePaperDcaDecision,finalisePaperDcaDecision,paperSma200,paperDcaBudget} from '../src/dca/paper.js';
const DAY=86_400_000,HOUR=3_600_000;
function fixture(){
 const sqlite=new Database(':memory:');
 sqlite.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,strategy TEXT NOT NULL,status TEXT NOT NULL,cash REAL NOT NULL);
 INSERT INTO accounts VALUES('dca','dca','active',0);
 CREATE TABLE candles(pair TEXT NOT NULL,interval INTEGER NOT NULL,ts INTEGER NOT NULL,
 close REAL NOT NULL,PRIMARY KEY(pair,interval,ts));`);
 initPaperDcaLedger(sqlite);return sqlite;
}
test('once-per-UTC-period deposits are transactional and repeat-safe',()=>{
 const sqlite=fixture(),now=Date.UTC(2026,10,6);
 try {
  expect(dcaPeriod(now,'monthly')).toBe('2026-11');
  expect(dcaPeriod(now,'weekly')).toBe('2026-11-02');
  expect(depositPaperCash(sqlite,'dca','2026-11',100,now)).toBe(true);
  expect(depositPaperCash(sqlite,'dca','2026-11',100,now)).toBe(false);
  expect((sqlite.prepare('SELECT cash FROM accounts WHERE id=?').get('dca') as {cash:number}).cash).toBe(100);
  expect(reservePaperDcaDecision(sqlite,'2026-11','classic',now)).toBe(true);
  expect(reservePaperDcaDecision(sqlite,'2026-11','classic',now)).toBe(false);
  finalisePaperDcaDecision(sqlite,'2026-11','not-filled','Market data unavailable');
  expect(sqlite.prepare('SELECT count(*) AS n FROM dca_paper_deposits').get()).toEqual({n:1});
  expect(sqlite.prepare('SELECT status FROM dca_paper_decisions').get()).toEqual({status:'not-filled'});
 }finally{sqlite.close();}
});
test('DCA configs and parked/double budgets fail closed on invalid inputs',()=>{
 expect(loadPaperDcaSettings({DCA_AMOUNT:'100',DCA_INTERVAL:'monthly',DCA_ALLOCATION:'70/30',DCA_VARIANT:'classic'}).allocation.btc).toBe(.7);
 expect(()=>loadPaperDcaSettings({DCA_ALLOCATION:'110/-10'})).toThrow();
 expect(()=>loadPaperDcaSettings({DCA_AMOUNT:'NaN'})).toThrow();
 const base=loadPaperDcaSettings({});
 expect(paperDcaBudget({...base,variant:'classic'},100,150,null)).toBe(100);
 expect(paperDcaBudget({...base,variant:'trend-park'},100,150,false)).toBe(0);
 expect(paperDcaBudget({...base,variant:'trend-park'},100,150,true)).toBe(150);
 expect(paperDcaBudget({...base,variant:'trend-double'},100,150,false)).toBe(150);
 expect(paperDcaBudget({...base,variant:'value-average'},100,150,null)).toBeNull();
});
test('trend uses exactly 200 past complete daily bars, rejecting missing hourly coverage',()=>{
 const sqlite=fixture(),today=Date.UTC(2026,10,6);
 try {
  sqlite.transaction(()=>{
   const add=sqlite.prepare('INSERT INTO candles(pair,interval,ts,close) VALUES(?,?,?,?)');
   for(let i=0;i<200*24;i++)add.run('BTC/EUR',60,today-200*DAY+i*HOUR,100+i/10000);
  })();
  const sample=paperSma200(sqlite,'BTC/EUR',today+HOUR);
  expect(sample).not.toBeNull();
  expect(sample!.previousClose).toBeGreaterThan(sample!.sma);
  sqlite.prepare('DELETE FROM candles WHERE pair=? AND ts=?').run('BTC/EUR',today-90*DAY);
  expect(paperSma200(sqlite,'BTC/EUR',today+HOUR)).toBeNull();
 }finally{sqlite.close();}
});
