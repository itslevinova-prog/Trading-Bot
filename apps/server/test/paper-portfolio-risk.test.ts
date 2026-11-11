import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import type {MarketFeed} from '../src/market/types.js';
import type {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';
import {completedPaperDaily,completedBtcHours,initPortfolioRiskStore,paperRiskSnapshot,PaperPortfolioRiskGateway} from '../src/risk-engine/paper.js';

const HOUR=3_600_000,DAY=86_400_000,today=Date.UTC(2026,10,6),now=today+3*HOUR;
function fixture(){
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,cash REAL NOT NULL,peak_equity REAL NOT NULL);
 INSERT INTO accounts VALUES('rules',10000,10000);
 CREATE TABLE candles(pair TEXT NOT NULL,interval INTEGER NOT NULL,ts INTEGER NOT NULL,
 close REAL NOT NULL,PRIMARY KEY(pair,interval,ts));
 CREATE TABLE equity_snapshots(account_id TEXT NOT NULL,ts INTEGER NOT NULL,equity REAL NOT NULL,cash REAL NOT NULL,PRIMARY KEY(account_id,ts));`);
 db.transaction(()=>{
  const insert=db.prepare('INSERT INTO candles VALUES(?,?,?,?)');
  // 61 fully closed prior UTC days + the first three completed hours today.
  // The last hour is closed as of now, never read a partial candle.
  for(let i=0;i<61*24+3;i++){
   const ts=today-61*DAY+i*HOUR;
   insert.run('BTC/EUR',60,ts,100+Math.sin(i*.15)*.3+i*.002);
   insert.run('ETH/EUR',60,ts,90+Math.sin(i*.18)*.25+i*.001);
  }
 })();
 // Persisted, observed boundary valuations for UTC day/week budgets.
 const monday=today-((new Date(today).getUTCDay()+6)%7)*DAY;
 const startMark=db.prepare('INSERT INTO equity_snapshots VALUES(?,?,?,?)');
 startMark.run('rules',monday,10000,10000);
 startMark.run('rules',today,10000,10000);
 const books=new Map([['BTC/EUR',{valid:true,receivedAt:now-1000}],['ETH/EUR',{valid:true,receivedAt:now-1000}]]);
 const market={venue:'kraken',connected:true,books,tickers:new Map(),features:new Map(),
  start:async()=>{},stop:()=>{},calculate:()=>{}} as unknown as MarketFeed;
 let equity=10000;
 const broker={valuation:()=>({equity,positions:[]})} as unknown as Pick<PaperExecutionAdapter,'valuation'>;
 initPortfolioRiskStore(db);
 return {db,market,broker,setEquity:(v:number)=>{equity=v;}};
}
test('daily and hourly risk inputs require contiguous closed paper bars',()=>{
 const f=fixture();
 try{
  expect(completedPaperDaily(f.db,'BTC/EUR',now)).toHaveLength(61);
  expect(completedBtcHours(f.db,'BTC/EUR',now)).toHaveLength(721);
  const s=paperRiskSnapshot(f.db,f.broker,f.market,'rules','ETH/EUR','EUR',now);
  expect(s.daily.BTCUSDT).toHaveLength(61);
  expect(s.daily['ETH/EUR']).toHaveLength(61);
  f.db.prepare('DELETE FROM candles WHERE pair=? AND ts=?').run('BTC/EUR',today-30*DAY+6*HOUR);
  expect(completedPaperDaily(f.db,'BTC/EUR',now)).toEqual([]);
  expect(completedBtcHours(f.db,'BTC/EUR',now)).toEqual([]);
 }finally{f.db.close();}
});
test('live paper guard persists a hard stop and only a local audit reset releases it',()=>{
 const f=fixture();
 try{
  const g=new PaperPortfolioRiskGateway(f.db,f.broker,f.market,'EUR');
  const good=g.evaluateBuy('rules','ETH/EUR',1000,now);
  expect(good.allowed).toBe(true);
  f.setEquity(8400);
  const stopped=g.evaluateBuy('rules','ETH/EUR',1000,now);
  expect(stopped.status).toBe('halted');
  expect((f.db.prepare('SELECT halted FROM portfolio_risk_latches WHERE account_id=?').get('rules') as {halted:number}).halted).toBe(1);
  f.setEquity(10000);
  const restarted=new PaperPortfolioRiskGateway(f.db,f.broker,f.market,'EUR');
  expect(restarted.evaluateBuy('rules','ETH/EUR',1000,now).status).toBe('halted');
  expect(()=>restarted.resetByOwner('rules','no')).toThrow(/acknowledgement/);
  restarted.resetByOwner('rules','I_ACKNOWLEDGE_MANUAL_RISK_RESET',now);
  expect(restarted.evaluateBuy('rules','ETH/EUR',1000,now).status).toBe('ok');
  expect((f.db.prepare('SELECT count(*) AS n FROM portfolio_risk_audit').get() as {n:number}).n).toBe(4);
 }finally{f.db.close();}
});
