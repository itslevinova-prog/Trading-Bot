import {test} from 'node:test';
import assert from 'node:assert/strict';
import {simulateSleeve,buyOrSellAtOpen,START,DAY,FEE_RATE,SLIPPAGE_RATE,
 classify,runFixedComparison,END} from './trend-1d-spike.mjs';

const bar=(i,open,close=open)=>({ts:START+i*DAY,open,high:Math.max(open,close),low:Math.min(open,close),close,volume:1});
test('close(t) SMA signal cannot fill until next open(t+1)',()=>{
 const bars=[bar(0,100,100),bar(1,100,100),bar(2,100,200),bar(3,300,301),bar(4,90,90)];
 const s=simulateSleeve(bars,500,3);
 assert.ok(s.trades.length>0);
 assert.equal(s.trades[0].ts,START+3*DAY);
 assert.equal(s.trades[0].referenceOpen,300);
 assert.ok(Math.abs(s.trades[0].fillPrice-300*(1+SLIPPAGE_RATE))<1e-9);
});
test('buy and sell each charge 10 bps fee + adverse 5 bps slippage',()=>{
 const s={cash:1000,qty:0,costs:0,trades:[]};
 const buy=buyOrSellAtOpen(s,'buy',100,START);
 assert.ok(Math.abs(buy.fillPrice-100*(1+SLIPPAGE_RATE))<1e-9);
 assert.ok(Math.abs(buy.fee-buy.qty*buy.fillPrice*FEE_RATE)<1e-9);
 assert.ok(Math.abs(buy.slippageCost-buy.qty*100*SLIPPAGE_RATE)<1e-9);
 const sell=buyOrSellAtOpen(s,'sell',100,START+DAY);
 assert.ok(Math.abs(sell.fillPrice-100*(1-SLIPPAGE_RATE))<1e-9);
 assert.ok(Math.abs(sell.fee-sell.qty*sell.fillPrice*FEE_RATE)<1e-9);
 assert.ok(s.cash<1000);
 assert.equal(s.qty,0);
 assert.ok(s.costs>0);
});
test('window, universe and historical completeness are immutable',()=>{
 const rows=Array.from({length:(END-START)/DAY},(_,i)=>bar(i,100,100));
 const comparison=runFixedComparison(rows,rows);
 assert.deepEqual(comparison.variants.map(v=>v.window),[50,100,200]);
 assert.deepEqual(comparison.markets,['BTCUSDT','ETHUSDT']);
 assert.deepEqual(comparison.range,{fromInclusive:'2020-01-01',toExclusive:'2024-01-01'});
 assert.throws(()=>runFixedComparison(rows.slice(0,-1),rows),/complete contiguous/);
 assert.throws(()=>runFixedComparison([{...rows[0],ts:END},...rows.slice(1)],rows),/archive gap/);
});
test('classification is declared before observing historical prices',()=>{
 const baseline={sharpe:1,calmar:2};
 assert.equal(classify([{sharpe:1.1,calmar:2.2}],baseline).status,'green');
 assert.equal(classify([{sharpe:.9,calmar:2.2}],baseline).status,'yellow');
 assert.equal(classify([{sharpe:.9,calmar:1.9}],baseline).status,'red');
 assert.equal(classify([{sharpe:1.1,calmar:2.2}],{sharpe:null,calmar:1}).status,'unclassifiable');
});
