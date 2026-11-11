import {sqlite} from '../db.js';
import {projectRoot} from '../config.js';
import {buildTaxExport,writeTaxExport} from './export.js';
import type {ExportOptions} from './export.js';

function args():Pick<ExportOptions,'year'|'currency'|'method'|'accountId'|'delimiter'> {
  const options=new Map<string,string>();
  const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i+=2){
    const flag=argv[i],value=argv[i+1];
    if(!flag?.startsWith('--')||value===undefined||value.startsWith('--'))throw Error('Syntax: --year 2026 --currency CHF --method fifo [--account id] [--delimiter ";"]');
    if(!['--year','--currency','--method','--account','--delimiter'].includes(flag))throw Error('Unbekannte Option: '+flag);
    options.set(flag,value);
  }
  const year=Number(options.get('--year')??new Date().getFullYear());
  const currency=options.get('--currency')??'CHF',method=options.get('--method')??'fifo';
  if(!Number.isInteger(year)||year<2000||year>2100)throw Error('Ungültiges Steuerjahr');
  if(currency!=='CHF'&&currency!=='EUR')throw Error('Währung muss CHF oder EUR sein');
  if(method!=='fifo'&&method!=='average')throw Error('Methode muss fifo oder average sein');
  const delimiter=options.get('--delimiter')??';';
  if(![';',',','\t'].includes(delimiter))throw Error('Trennzeichen muss ;, Komma oder Tab sein');
  return {year,currency,method,accountId:options.get('--account'),delimiter};
}
try {
  const options=args();
  const report=await buildTaxExport(sqlite,{...options,root:projectRoot});
  const path=await writeTaxExport(report,projectRoot);
  process.stdout.write('Steuer-Export erstellt: '+path+'\n');
  process.stdout.write('Abgleich: '+JSON.stringify({pnl:report.summary.pnlReconciliation,cash:report.summary.cashReconciliation})+'\n');
} catch(e) {
  process.stderr.write('Steuer-Export fehlgeschlagen: '+(e instanceof Error?e.message:String(e))+'\n');
  process.exitCode=1;
} finally {
  sqlite.close();
}
