import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import type {MarketFeed} from '../src/market/types.js';
import type {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';
import {DEFAULT_QUOTE_EXPOSURE_LIMITS,evaluateQuoteExposure,paperQuoteCrosses,
 type QuoteExposureInputs} from '../src/risk-engine/quote-exposure.js';
import {PaperPortfolioRiskGateway} from '../src/risk-engine/paper.js';

const now=Date.UTC(2023,6,1,12);
function sample():QuoteExposureInputs {
 return {
  now,quote:'USDT',equityQuote:10_000,availableCashQuote:7_000,reservedQuote:500,
  positions:[{pair:'BTC/USDT',valueQuote:1_000},{pair:'ETH/USDT',valueQuote:1_500}],
  entryDebitQuote:1_000,
  eurPerUsd:{rate:.9,receivedAt:now-1000,source:'USD/EUR'},
  stablecoinUsd:{rate:.998,receivedAt:now-1000,source:'USDT/USD'}
 };
}
test('different base coins aggregate into one settlement quote, with distinct cash and base inventory',()=>{
 const v=evaluateQuoteExposure(sample());
 expect(v.status).toBe('ok');
 expect(v.allowed).toBe(true);
 expect(v.quoteEurRate).toBeCloseTo(.8982);
 expect(v.cashEur).toBeCloseTo(7_000*.8982);
 expect(v.reservedEur).toBeCloseTo(500*.8982);
 expect(v.basePositionsEur).toBeCloseTo(2_500*.8982);
 expect(v.projectedCashEur).toBeCloseTo(6_000*.8982);
 expect(v.projectedQuotePct).toBeCloseTo(.65);
 expect(v.settlementQuotePct).toBeCloseTo(1);
 // Asset labels cannot disguise the same quote settlement exposure.
 const renamed=sample();renamed.positions[0]!.pair='SOL/USDT';
 expect(evaluateQuoteExposure(renamed)).toEqual(v);
});
test('stablecoin quote cap and warning use projected liquidity without auto-rebalancing',()=>{
 const limits={...DEFAULT_QUOTE_EXPOSURE_LIMITS,warningPct:.6,blockPct:.72};
 const blocked=sample();blocked.entryDebitQuote=100;
 expect(evaluateQuoteExposure(blocked,limits)).toMatchObject({
  allowed:false,status:'blocked',projectedQuotePct:.74
 });
 const warning=sample();
 expect(evaluateQuoteExposure(warning,limits)).toMatchObject({
  allowed:true,status:'warning',projectedQuotePct:.65
 });
 const reduced=sample();reduced.entryDebitQuote=2_000;
 expect(evaluateQuoteExposure(reduced,limits)).toMatchObject({allowed:true,status:'ok'});
});
test('missing, future, stale and depegged spot FX never become an assumed 1:1 peg',()=>{
 const missing=sample();delete missing.stablecoinUsd;
 expect(evaluateQuoteExposure(missing)).toMatchObject({status:'blocked',quoteEurRate:null});
 const noUsd=sample();delete noUsd.eurPerUsd;
 expect(evaluateQuoteExposure(noUsd).reasons.join()).toMatch(/USD\/EUR/);
 const depeg=sample();depeg.stablecoinUsd={rate:.95,receivedAt:now,source:'USDT/USD'};
 expect(evaluateQuoteExposure(depeg).reasons.join()).toMatch(/depeg/);
 const future=sample();future.stablecoinUsd={rate:1,receivedAt:now+1,source:'USDT/USD'};
 expect(evaluateQuoteExposure(future).status).toBe('blocked');
 const stale=sample();stale.eurPerUsd={rate:1,receivedAt:now-30_001,source:'USD/EUR'};
 expect(evaluateQuoteExposure(stale).status).toBe('blocked');
});
test('invalid cash reservation, mixed pairs and mismatched mark-to-market fail closed',()=>{
 const duplicate=sample();duplicate.reservedQuote+=1_000;
 expect(evaluateQuoteExposure(duplicate).reasons.join()).toMatch(/reconcile/);
 const invalid=sample();invalid.entryDebitQuote=7_001;
 expect(evaluateQuoteExposure(invalid).status).toBe('blocked');
 const mixed=sample();mixed.positions[1]!.pair='ETH/USDC';
 expect(evaluateQuoteExposure(mixed).status).toBe('blocked');
 const noPrice=sample();noPrice.positions[1]!.valueQuote=NaN;
 expect(evaluateQuoteExposure(noPrice).status).toBe('blocked');
});
test('native EUR account can buy without fictitious stablecoin FX exposure',()=>{
 const state:QuoteExposureInputs={now,quote:'EUR',equityQuote:10_000,
  availableCashQuote:8_000,reservedQuote:0,
  positions:[{pair:'BTC/EUR',valueQuote:2_000}],entryDebitQuote:500};
 expect(evaluateQuoteExposure(state)).toMatchObject({
  allowed:true,status:'ok',quoteEurRate:1,projectedQuotePct:.75
 });
});
function spot(bid:number,receivedAt=now-1000){
 return {symbol:'fixture/spot',valid:true,receivedAt,bids:[{price:String(bid),qty:'100000'}],
  asks:[{price:String(bid*1.001),qty:'100000'}]};
}
test('spot quote observations require a connected valid book and never use missing crosses',()=>{
 const market={connected:true,books:new Map<string,ReturnType<typeof spot>>([
  ['USDT/USD',spot(.998)],['USD/EUR',spot(.91)]
 ])} as unknown as Pick<MarketFeed,'books'|'connected'>;
 const valid=paperQuoteCrosses(market,'USDT',now);
 expect(valid.eurPerUsd?.rate).toBe(.91);
 expect(valid.stablecoinUsd?.rate).toBe(.998);
 market.connected=false;
 expect(paperQuoteCrosses(market,'USDT',now)).toMatchObject({eurPerUsd:null,stablecoinUsd:null});
 market.connected=true;market.books.delete('USD/EUR');
 expect(paperQuoteCrosses(market,'USDT',now).eurPerUsd).toBeNull();
 market.books.set('EUR/USD',spot(1.08));
 expect(paperQuoteCrosses(market,'USDT',now).eurPerUsd?.rate).toBeCloseTo(1/(1.08*1.001));
});
test('Paper gateway writes FX unknown as audit denial and leaves exits independent',()=>{
 const sql=new Database(':memory:');
 try{
  sql.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,cash REAL,peak_equity REAL);
   INSERT INTO accounts VALUES('rules',10000,10000);
   CREATE TABLE candles(pair TEXT,interval INTEGER,ts INTEGER,close REAL);`);
  const market={connected:true,books:new Map([
   ['BTC/USDT',spot(100)],['ETH/USDT',spot(100)]
  ]),tickers:new Map(),features:new Map(),venue:'binance',
   start:async()=>{},stop:()=>{},calculate:()=>{}} as unknown as MarketFeed;
  const broker={valuation:()=>({equity:10000,positions:[]})} as unknown as Pick<PaperExecutionAdapter,'valuation'>;
  const gateway=new PaperPortfolioRiskGateway(sql,broker,market,'USDT');
  const decision=gateway.evaluateBuy('rules','ETH/USDT',1000,now);
  expect(decision.allowed).toBe(false);
  expect(decision.reasons.join()).toMatch(/USD\/EUR/);
  const audit=sql.prepare('SELECT allowed,reasons FROM portfolio_risk_audit ORDER BY id DESC LIMIT 1')
   .get() as {allowed:number;reasons:string};
  expect(audit.allowed).toBe(0);
  expect(audit.reasons).toMatch(/Quote concentration USDT: blocked/);
  expect(sql.prepare('SELECT count(*) AS n FROM portfolio_risk_latches')
   .get()).toEqual({n:0});
 }finally{sql.close();}
});
