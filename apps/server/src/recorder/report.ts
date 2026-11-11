import {getMonthReport} from './reader.js';
import {loadCostReport} from './cost-report.js';
import {monthOf} from './storage.js';

function main(args:string[]) {
  if(args.length>2||args.length===1&&args[0]!=='--month'||args.length===2&&args[0]!=='--month')
    throw Error('Usage: pnpm record:report [--month YYYY-MM]');
  const month=args[1]??monthOf(Date.now());
  const report=getMonthReport(month);
  if(!report.exists){console.error('No market recording for '+month+': '+report.file);process.exitCode=1;return;}
  const display=(value:number|null)=>value===null?'—':value.toFixed(2);
  console.log('Public Binance market recorder — '+month+' (UTC)');
  console.log('File: '+report.file);
  console.log('SQLite + WAL/SHM: '+(report.sizeBytes/1024/1024).toFixed(1)+' MiB; snapshot interval '+report.intervalMs+' ms');
  console.table(report.pairs.map(p=>({
    pair:p.symbol,'coverage %':p.coveragePct.toFixed(1),
    snapshots:p.snapshots,expected:p.expected,gaps:p.gaps,trades:p.trades,
    'median bps':display(p.medianBps),'P90 bps':display(p.p90Bps),
  })));
  const costCoverage=loadCostReport(month);
  console.log('Independent market observation coverage: '+costCoverage.coverageStatus+
    ' (does NOT certify executable fill costs)');
  console.log('Observed UTC window: '+
    (costCoverage.observedFromMs===null?'n/a':new Date(costCoverage.observedFromMs).toISOString())+
    ' – '+(costCoverage.observedToMs===null?'n/a':new Date(costCoverage.observedToMs).toISOString()));
  console.table(costCoverage.markets.map(m=>({
    symbol:m.symbol,days:m.coverage.qualifyingUtcDays,
    '6h UTC blocks':m.coverage.observedSixHourBlocks,
    'day/block windows':m.coverage.qualifyingDayBlocks,
    'span days':m.coverage.observationSpanDays,
    status:m.coverage.status
  })));
    console.log('Per quote: exact pooled snapshot median and P90 across pairs');
  console.table(report.quotes.map(q=>({quote:q.quote,pairs:q.pairs,
    'median bps':display(q.medianBps),'P90 bps':display(q.p90Bps)})));
}
try{main(process.argv.slice(2));}catch(error){console.error(String(error));process.exitCode=1;}
