import {test,expect} from 'vitest';import {compareResearchReports} from '../src/research/comparison.js';
const report={generatedAt:'2026-01-01T00:00:00Z',strategyVersion:'strategy-a',dataHash:'a'.repeat(64),universeHash:'b'.repeat(64),fixedDataset:{datasetId:'c'.repeat(64),optionsHash:'d'.repeat(64)},base:{returnPct:-1,closedTrades:2,missingValuationBars:0,unliquidatedPositions:0},stress:{returnPct:-2}};
test('only fully frozen equal data, market order, filters and options allow a paired return difference',()=>{const result=compareResearchReports({...report,base:{...report.base,returnPct:0}},report);expect(result).toMatchObject({available:true,inputsComparable:true,returnDifferencePercentagePoints:1,sameStrategyVersion:true});expect(result.warning).toContain('do not establish independent profitability');});
test('dropping a losing market or sliding the window cannot be called a strategy improvement',()=>{for(const patch of [{dataHash:'e'.repeat(64)},{universeHash:'f'.repeat(64)},{fixedDataset:{...report.fixedDataset,optionsHash:'e'.repeat(64)}}])expect(compareResearchReports({...report,...patch,base:{returnPct:0,closedTrades:0}},report)).toMatchObject({inputsComparable:false,returnDifferencePercentagePoints:null});});
test('legacy rolling reports remain visible but are never silently paired with a frozen sample',()=>{const previous={...report,fixedDataset:null};expect(compareResearchReports(report,previous)).toMatchObject({available:true,inputsComparable:false,previousReturnPct:-1,previousClosedTrades:2,returnDifferencePercentagePoints:null});});
test('broken metrics and missing reports do not fabricate a positive comparison',()=>{for(const previous of [undefined,{},[],{...report,generatedAt:'2999-01-01T00:00:00Z'},{...report,base:{returnPct:NaN,closedTrades:0}},{...report,base:{returnPct:1,closedTrades:-1}}])expect(compareResearchReports(report,previous)).toMatchObject({available:false,inputsComparable:false});});


test('identical inputs do not permit a paired return delta if either outcome has incomplete coverage',()=>{
 const current={...report,base:{...report.base,returnPct:1}};
 for(const incomplete of [
  {...current.base,missingValuationBars:1},
  {...current.base,unliquidatedPositions:1},
  {returnPct:1,closedTrades:2},
 ]){
  for(const [a,b] of [[{...current,base:incomplete},report],[current,{...report,base:incomplete}]] as const){
   expect(compareResearchReports(a,b)).toMatchObject({
    available:true, inputsComparable:true, outcomesComparable:false, returnDifferencePercentagePoints:null,
   });
  }
 }
});
