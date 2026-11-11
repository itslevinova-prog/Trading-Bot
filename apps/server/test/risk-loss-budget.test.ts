import {expect,test} from 'vitest';
import Database from 'better-sqlite3';
import type {MarketFeed} from '../src/market/types.js';
import type {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';
import {PortfolioRiskEngine,evaluatePaperLossBudget,utcRiskPeriodStart} from '../src/risk-engine/engine.js';
import {initPortfolioRiskStore,paperLossBudgetStatus,recordPaperRiskExternalFlow,PaperPortfolioRiskGateway} from '../src/risk-engine/paper.js';

const DAY=86_400_000,HOUR=3_600_000;
const today=Date.UTC(2026,10,6),now=today+3*HOUR;
const monday=utcRiskPeriodStart(now,'week');
const base={day:{period:'day' as const,startMs:today,equity:10_000,netExternalFlow:0},
 week:{period:'week' as const,startMs:monday,equity:10_000,netExternalFlow:0}};
function fixture(includeBoundaries=true) {
 const sqlite=new Database(':memory:');
 sqlite.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,cash REAL NOT NULL,peak_equity REAL NOT NULL);
 INSERT INTO accounts VALUES('rules',10000,10000);
 CREATE TABLE candles(pair TEXT NOT NULL,interval INTEGER NOT NULL,ts INTEGER NOT NULL,close REAL NOT NULL,PRIMARY KEY(pair,interval,ts));
 CREATE TABLE equity_snapshots(account_id TEXT NOT NULL,ts INTEGER NOT NULL,equity REAL NOT NULL,cash REAL NOT NULL,PRIMARY KEY(account_id,ts));`);
 const put=sqlite.prepare('INSERT INTO candles VALUES(?,?,?,?)');
 sqlite.transaction(()=>{
  for(let i=0;i<61*24+3;i++){
   const ts=today-61*DAY+i*HOUR;
   put.run('BTC/EUR',60,ts,100+Math.sin(i*.15)*.3+i*.002);
   put.run('ETH/EUR',60,ts,90+Math.sin(i*.18)*.25+i*.001);
  }
 })();
 if(includeBoundaries){
  const equity=sqlite.prepare('INSERT INTO equity_snapshots VALUES(?,?,?,?)');
  equity.run('rules',monday,10000,10000);
  equity.run('rules',today,10000,10000);
 }
 const market={
  venue:'kraken',connected:true,
  books:new Map([['BTC/EUR',{valid:true,receivedAt:now-1000}],['ETH/EUR',{valid:true,receivedAt:now-1000}]]),
  tickers:new Map(),features:new Map()
 } as unknown as MarketFeed;
 let accountEquity=10000;
 const broker = {valuation:()=>({equity:accountEquity,positions:[]})} as unknown as Pick<PaperExecutionAdapter,'valuation'>;
 initPortfolioRiskStore(sqlite);
 return {sqlite,market,broker,setEquity:(value:number)=>{accountEquity=value;}};
}

test('UTC days and ISO-style Monday week boundaries never depend on local timezone',()=>{
 expect(utcRiskPeriodStart(Date.UTC(2026,10,8,23,59),'week')).toBe(Date.UTC(2026,10,2));
 expect(utcRiskPeriodStart(Date.UTC(2026,10,9,0,0),'week')).toBe(Date.UTC(2026,10,9));
 expect(utcRiskPeriodStart(Date.UTC(2026,10,7,0,1),'day')).toBe(Date.UTC(2026,10,7));
 expect(utcRiskPeriodStart(now,'day')).toBe(today);
});

test('pure budget includes realized/unrealized changes and removes only audited external cash flows',()=>{
 expect(evaluatePaperLossBudget(now,9900,base.day,base.week).status).toBe('ok');
 const dayBreach=evaluatePaperLossBudget(now,9690,base.day,base.week);
 expect(dayBreach.status).toBe('halted');
 expect(dayBreach.dailyLossPct).toBeCloseTo(.031);
 expect(dayBreach.weeklyLossPct).toBeCloseTo(.031);
 expect(dayBreach.reasons).toContain('UTC-Tagesverlustbudget erreicht; nur Ausstiege bis zum manuellen Risiko-Reset.');
 const neutralized=evaluatePaperLossBudget(now,11900,
  {...base.day,netExternalFlow:2000},{...base.week,netExternalFlow:2000});
 expect(neutralized.status).toBe('ok');
 expect(neutralized.dailyLossPct).toBeCloseTo(.01);
 const despiteDeposit=evaluatePaperLossBudget(now,11600,
  {...base.day,netExternalFlow:2000},{...base.week,netExternalFlow:2000});
 expect(despiteDeposit.status).toBe('halted');
 expect(despiteDeposit.dailyLossPct).toBeCloseTo(.04);
 const withdrawn=evaluatePaperLossBudget(now,7900,
  {...base.day,netExternalFlow:-2000},{...base.week,netExternalFlow:-2000});
 expect(withdrawn.status).toBe('ok');
 expect(withdrawn.dailyLossPct).toBeCloseTo(.01);
});

test('weekly loss stays blocked even if the new day is below its daily threshold',()=>{
 const day={...base.day,equity:9500};
 const weekly=evaluatePaperLossBudget(now,9350,day,base.week);
 expect(weekly.dailyLossPct).toBeCloseTo(.015789473684210575,10);
 expect(weekly.weeklyLossPct).toBeCloseTo(.065,10);
 expect(weekly.status).toBe('halted');
 expect(weekly.reasons.some(x=>x.includes('Wochenverlustbudget'))).toBe(true);
});

test('missing UTC opening mark, non-finite equity or incorrect boundary fail closed',()=>{
 expect(evaluatePaperLossBudget(now,10000,null,base.week).status).toBe('unknown');
 expect(evaluatePaperLossBudget(now,10000,base.day,null).status).toBe('unknown');
 expect(evaluatePaperLossBudget(now,NaN,base.day,base.week).status).toBe('unknown');
 expect(evaluatePaperLossBudget(now,10000,{...base.day,startMs:today-DAY},base.week).status).toBe('unknown');
});

test('immutable period baselines and deposit evidence survive restart and cannot silently rewrite',()=>{
 const f=fixture(false);
 try{
  expect(paperLossBudgetStatus(f.sqlite,'rules',10000,now).status).toBe('unknown');
  const insert=f.sqlite.prepare('INSERT INTO equity_snapshots VALUES(?,?,?,?)');
  insert.run('rules',monday,10000,10000);insert.run('rules',today,10000,10000);
  expect(paperLossBudgetStatus(f.sqlite,'rules',10000,now).status).toBe('ok');
  // A later rewrite to an equity snapshot cannot mutate its captured risk anchor.
  f.sqlite.prepare('UPDATE equity_snapshots SET equity=30000 WHERE account_id=? AND ts=?').run('rules',today);
  expect(paperLossBudgetStatus(f.sqlite,'rules',9690,now).status).toBe('halted');
  recordPaperRiskExternalFlow(f.sqlite,'rules','cash-credit-1',2000,
   'Locally evidenced external cash deposit',now-1000);
  expect(paperLossBudgetStatus(f.sqlite,'rules',11900,now).status).toBe('ok');
  expect(()=>recordPaperRiskExternalFlow(f.sqlite,'rules','cash-credit-1',2000,
   'Duplicate deposit cannot be registered',now-1000)).toThrow();
  const restarted=paperLossBudgetStatus(f.sqlite,'rules',11600,now);
  expect(restarted.status).toBe('halted');
  expect(restarted.dailyLossPct).toBeCloseTo(.04);
  const anchor=f.sqlite.prepare('SELECT start_equity FROM portfolio_risk_period_baselines WHERE account_id=? AND period=? AND period_start=?')
   .get('rules','day',today) as {start_equity:number};
  expect(anchor.start_equity).toBe(10000);
 }finally{f.sqlite.close();}
});

test('paper entry is blocked, latched and audited at daily budget, while exits remain permitted',()=>{
 const f=fixture();
 try{
  const gate=new PaperPortfolioRiskGateway(f.sqlite,f.broker,f.market,'EUR');
  expect(gate.evaluateBuy('rules','ETH/EUR',1000,now).allowed).toBe(true);
  f.setEquity(9690);
  const blocked=gate.evaluateBuy('rules','ETH/EUR',1000,now);
  expect(blocked.allowed).toBe(false);
  expect(blocked.status).toBe('halted');
  expect(blocked.reasons.some(x=>x.includes('Tagesverlustbudget'))).toBe(true);
  expect((f.sqlite.prepare('SELECT halted FROM portfolio_risk_latches WHERE account_id=?')
   .get('rules') as {halted:number}).halted).toBe(1);
  f.setEquity(10000);
  const next=new PaperPortfolioRiskGateway(f.sqlite,f.broker,f.market,'EUR');
  expect(next.evaluateBuy('rules','ETH/EUR',1000,now+DAY).status).toBe('halted');
  expect(new PortfolioRiskEngine().evaluateExit().allowed).toBe(true);
  expect(()=>next.resetByOwner('rules','wrong',now)).toThrow();
  next.resetByOwner('rules','I_ACKNOWLEDGE_MANUAL_RISK_RESET',now);
  expect(next.evaluateBuy('rules','ETH/EUR',1000,now).allowed).toBe(true);
  const audit=f.sqlite.prepare('SELECT state,approved FROM portfolio_risk_audit ORDER BY id DESC LIMIT 1')
   .get() as {state:string;approved:number};
  expect(audit.state).toBe('ok');
  expect(audit.approved).toBeGreaterThan(0);
 }finally{f.sqlite.close();}
});
