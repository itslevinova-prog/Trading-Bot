import {ACCOUNTS,LABEL,type Account,type Point,type State,type summary} from './engine-v2.js';

/** German, human-readable reports for reflection. Pure functions of the persisted state. */
const NAMES:Record<Account,string>={strategy:'Basis-Strategie',vorsichtig:'Profil vorsichtig',normal:'Profil normal',
 aggressiv:'Profil aggressiv',hold:'BTC kaufen und halten',dca:'Sparplan 70/30 BTC/ETH'};
const date=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const money=(x:number|null)=>x===null?'unbekannt':x.toFixed(2);
const pct=(x:number|null|undefined)=>x===null||x===undefined?'–':(x>=0?'+':'')+(x*100).toFixed(2)+' %';
type Metrics=ReturnType<typeof summary>;

export function dayReport(s:State,point:Point):string{
 const fills=s.fills.filter(f=>f.day===point.day);
 const index=s.points.indexOf(point),previous=index>0?s.points[index-1]:undefined;
 const rows=ACCOUNTS.map(a=>{
  const base=previous?previous[a]:a==='dca'?null:10000;
  const change=point[a]!==null&&base!==null&&base!==undefined&&a!=='dca'?point[a]!/base-1:null;
  return `| ${NAMES[a]} | ${money(point[a])} | ${pct(change)} | ${fills.filter(f=>f.account===a).length} |`;
 });
 return [`# ${date(point.day)}`,'',LABEL,'','## Entscheidung','',point.reason,'',
  '## Begründung','',...(point.details?.length?point.details.map(d=>'- '+d):['- Keine Details gespeichert.']),'',
  '## Kontostände (USDT)','','| Konto | Stand | Veränderung zum Vortag | Trades heute |','|---|---:|---:|---:|',...rows,'',
  ...(fills.length?['## Simulierte Trades','','| Konto | Seite | Symbol | Menge | Preis | Kosten |','|---|---|---|---:|---:|---:|',
   ...fills.map(f=>`| ${NAMES[f.account as Account]??f.account} | ${f.side==='buy'?'Kauf':'Verkauf'} | ${f.symbol} | ${f.qty} | ${f.price.toFixed(2)} | ${(f.fee+f.spread+f.slippage).toFixed(2)} |`),'']:[]),
  'Sparplan: Veränderung nicht direkt vergleichbar (monatliche Einzahlungen).',''].join('\n');
}

export function overviewReport(s:State,id:string,metrics:Record<Account,Metrics>):string{
 const last=s.points.at(-1);
 const lines=[`# ${LABEL}`,'',`Serie ${id}; seit ${date(s.start)}.`,'',
  `${s.points.length} Tage; ${s.fills.length} simulierte Fills. Sparplan mit zusätzlichen monatlichen Einzahlungen; Endvermögen nicht direkt vergleichbar.`,'',
  '## Gesamtstand','','| Konto | Stand (USDT) | Rendite | Max. Drawdown | Sharpe | Trades | Kosten (USDT) |','|---|---:|---:|---:|---:|---:|---:|',
  ...ACCOUNTS.map(a=>{const m=metrics[a];return `| ${NAMES[a]} | ${money(last?.[a]??null)} | ${pct(m?.return)} | ${m?'-'+(m.maxDrawdown*100).toFixed(2)+' %':'–'} | ${m?.sharpe?.toFixed(2)??'– (ab 30 Tagen)'} | ${s.fills.filter(f=>f.account===a).length} | ${m?m.costs.toFixed(2):'–'} |`;}),''];
 if(last)lines.push('## Letzte Begründung','',`${date(last.day)}: ${last.reason}`,'',...(last.details??[]).map(d=>'- '+d),'');
 const week=s.points.slice(-7);
 if(week.length){
  lines.push('## Letzte 7 Tage','','| Tag | '+ACCOUNTS.map(a=>NAMES[a]).join(' | ')+' | Entscheidung |','|---|'+ACCOUNTS.map(()=>'---:').join('|')+'|---|',
   ...week.map(p=>`| ${date(p.day)} | ${ACCOUNTS.map(a=>money(p[a])).join(' | ')} | ${p.reason} |`),'');
  const first=week[0]!,from=s.points[s.points.indexOf(first)-1];
  const change=(a:Account)=>{const b=from?from[a]:10000,e=week.at(-1)![a];return b===null||e===null?null:e/b-1;};
  lines.push('Wochenveränderung: '+ACCOUNTS.filter(a=>a!=='dca').map(a=>`${NAMES[a]} ${pct(change(a))}`).join(', ')+'.','');
 }
 lines.push('Profile sind vorregistrierte, gedeckelte Papier-Risikoprofile (keine Freigabe). Gleiche Signale, gleiches BTC-Regime, gleiche Kosten; nur Volatilitätsziel, Positionsanzahl und Investitionsgrenze unterscheiden sich.','');
 return lines.join('\n');
}
