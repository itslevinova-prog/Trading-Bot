import {expect,test} from 'vitest';
import {summarizeDcaRuns,DCA_VARIANTS} from '../src/dca/comparison.js';
import type {DcaResult,DcaVariant} from '../src/dca/simulator.js';

const day=86_400_000;
function synthetic(variant:DcaVariant,start:number,twr:number,irr:number|null=0):DcaResult {
 const deposits=[{ts:start,amount:100},{ts:start+30*day,amount:100}];
 return {variant,fromMs:start,toMs:start+60*day,contributed:200,netWorth:200*(1+twr),
  twr,irr,maxDrawdown:0,totalFees:0,tradeCount:0,deposits,trades:[],daily:[],
  constraints:{feeRate:.001,spreadBps:10,slippageBps:5,minNotional:10}};
}
function group(start:number) {
 return DCA_VARIANTS.map(variant=>synthetic(variant,start,variant==='classic'?0:0.01,
  variant==='classic'?0:0.02));
}
test('paired development summary uses all starts and compares only equal cash flows',()=>{
 const start=Date.UTC(2020,0,1),runs=[...group(start),...group(start+60*day)];
 const result=summarizeDcaRuns(runs);
 expect(result.kind).toBe('paired-development-only');
 expect(result.starts).toBe(2);
 expect(result.distributions.map(d=>d.variant)).toEqual([...DCA_VARIANTS]);
 expect(result.distributions.find(d=>d.variant==='classic')).toMatchObject({runs:2,missingIrr:0,
  deltaTwrVersusClassic:null});
 expect(result.pairs).toHaveLength(6);
 expect(result.pairs.every(p=>p.deltaTwr>0&&p.deltaIrr!==null)).toBe(true);
 expect(result.warning).toMatch(/Keine unabhängige Prüfung/);
});
test('missing IRR stays unknown rather than fabricated',()=>{
 const rows=group(Date.UTC(2020,0,1));
 rows[1]!.irr=null;
 const summary=summarizeDcaRuns(rows);
 expect(summary.distributions[1]).toMatchObject({irr:null,missingIrr:1,deltaIrrVersusClassic:null});
 expect(summary.pairs.find(p=>p.variant==='trend-park')!.deltaIrr).toBeNull();
});
test('rejects missing baseline, incomplete variants, duplicates, and unequal deposits or costs',()=>{
 const start=Date.UTC(2020,0,1),rows=group(start);
 expect(()=>summarizeDcaRuns([])).toThrow(/No DCA/);
 expect(()=>summarizeDcaRuns(rows.slice(1))).toThrow(/classic baseline/);
 expect(()=>summarizeDcaRuns(rows.slice(0,3))).toThrow(/four/);
 expect(()=>summarizeDcaRuns([...rows,rows[0]!])).toThrow(/Duplicate/);
 const missingDeposit=rows.map(r=>({...r,deposits:r.deposits.map(d=>({...d}))}));
 missingDeposit[2]!.deposits[0]!.amount=101;
 expect(()=>summarizeDcaRuns(missingDeposit)).toThrow(/identical deposits/);
 const costMismatch=rows.map(r=>({...r,constraints:{...r.constraints}}));
 costMismatch[1]!.constraints.feeRate=.002;
 expect(()=>summarizeDcaRuns(costMismatch)).toThrow(/identical deposits/);
});
