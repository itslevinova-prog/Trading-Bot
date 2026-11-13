import type {RiskLimits} from '../risk-engine/engine.js';

export type DiagnosticSource='broker'|'portfolioRisk'|'coinQuality'|'missingLot'|'planner';
export type DiagnosticRiskStatus='ok'|'caution'|'exit-only'|'halted';
export type DiagnosticDay={
 day:string;asOf:number;equity:number;cash:number;investedPct:number;allCash:boolean;
 riskStatus:DiagnosticRiskStatus;riskLatched:boolean;plannerBuySignal:boolean;executedBuy:boolean;
};
/** Passive observation only: the actual engine latches a hard stop only on evaluateBuy. */
export function diagnosticRiskStatus(equity:number,peak:number,limits:RiskLimits,latched:boolean):DiagnosticRiskStatus {
 const dd=peak>0?Math.max(0,1-equity/Math.max(peak,equity)):1;
 return latched||dd>=limits.hardStopDrawdown?'halted':
  dd>=limits.exitOnlyDrawdown?'exit-only':
  dd>=limits.cautionDrawdown?'caution':'ok';
}
export type DiagnosticTrace={
 days:DiagnosticDay[];
 reasons:Record<DiagnosticSource,Record<string,number>>;
};
export function emptyDiagnosticReasons():DiagnosticTrace['reasons']{
 return {broker:{},portfolioRisk:{},coinQuality:{},missingLot:{},planner:{}};
}
export function countDiagnosticReason(reasons:DiagnosticTrace['reasons'],source:DiagnosticSource,reason:string){
 const key=reason.trim()||'Ohne begründeten Entscheid';
 reasons[source][key]=(reasons[source][key]??0)+1;
}
export type DiagnosticYear={
 year:number;startEquity:number;endEquity:number;returnPct:number;
 maxDrawdownPct:number;endDrawdownPct:number;averageInvestedPct:number;cashDays:number;days:number;
};
export type DiagnosticAnalysis={
 statusDays:Record<DiagnosticRiskStatus,number>;
 firstExitOnly:string|null;firstHalted:string|null;engineLatchDays:number;
 plannerBuyDays:number;executedBuyDays:number;allCashDays:number;
 averageInvestedPct:number;years:DiagnosticYear[];
 exitOnlyRejections:number;cashLockedDays:number;firstCashLockedDay:string|null;
 lockFinding:'bestätigt'|'widerlegt'|'offen';lockEvidence:string;
};
/** Percentages here are fractions, not numbers on a 0..100 scale. */
export function analyzeDiagnosticTrace(trace:DiagnosticTrace,initialEquity:number):DiagnosticAnalysis{
 if(!Number.isFinite(initialEquity)||initialEquity<=0)throw Error('Invalid diagnostic initial equity');
 const days=[...trace.days].sort((x,y)=>x.asOf-y.asOf);
 if(new Set(days.map(d=>d.day)).size!==days.length||
    days.some(d=>d.day<'2020-01-01'||d.day>'2023-12-31'||
     !Number.isFinite(d.equity)||d.equity<=0||
     !Number.isFinite(d.investedPct)||d.investedPct<0||d.investedPct>1))
  throw Error('Diagnostic days must be unique sealed development valuations');
 const counts:DiagnosticAnalysis['statusDays']={'ok':0,caution:0,'exit-only':0,halted:0};
 for(const d of days)counts[d.riskStatus]++;
 const firstExitOnly=days.find(d=>d.riskStatus==='exit-only')?.day??null;
 const firstHalted=days.find(d=>d.riskStatus==='halted')?.day??null;
 let prior=initialEquity,globalPeak=initialEquity;
 const years:DiagnosticYear[]=[];
 for(const year of [2020,2021,2022,2023]){
  const group=days.filter(d=>d.day.startsWith(String(year)+'-'));
  if(!group.length)continue;
  let localPeak=prior,maxDD=0;
  for(const d of group){localPeak=Math.max(localPeak,d.equity);maxDD=Math.max(maxDD,1-d.equity/localPeak);globalPeak=Math.max(globalPeak,d.equity);}
  const end=group.at(-1)!.equity;
  years.push({year,startEquity:prior,endEquity:end,returnPct:end/prior-1,
   maxDrawdownPct:maxDD,endDrawdownPct:1-end/globalPeak,
   averageInvestedPct:group.reduce((n,d)=>n+d.investedPct,0)/group.length,
   cashDays:group.filter(d=>d.allCash).length,days:group.length});
  prior=end;
 }
 const exitOnlyRejections=Object.entries(trace.reasons.portfolioRisk).reduce((n,[reason,count])=>
  n+(reason.includes('Portfolio drawdown >= exit-only threshold')?count:0),0);
 const firstLockIndex=days.findIndex(d=>d.riskStatus==='exit-only'||d.riskStatus==='halted');
 const after=firstLockIndex<0?[]:days.slice(firstLockIndex);
 const cashLocked=after.filter(d=>d.allCash&&['exit-only','halted'].includes(d.riskStatus));
 const stillLocked=after.length>0&&after.every(d=>d.riskStatus==='exit-only'||d.riskStatus==='halted');
 const noReentry=after.length>0&&after.every(d=>!d.executedBuy);
 let lockFinding:DiagnosticAnalysis['lockFinding']='offen';
 if(!after.length)lockFinding='widerlegt';
 else if(exitOnlyRejections>0&&stillLocked&&noReentry&&cashLocked.length>0)lockFinding='bestätigt';
 else if(after.some(d=>d.executedBuy)||after.some(d=>d.riskStatus==='ok'||d.riskStatus==='caution'))
  lockFinding='widerlegt';
 const lockEvidence=lockFinding==='bestätigt'?
  'Exit-only hat Kaufversuche nachweislich abgewiesen, anschliessend blieb die Risikoschwelle durchgehend aktiv und es gab keinen erneuten Kauf.' :
  lockFinding==='widerlegt'?
   (after.length?'Nach Erreichen der Schwelle gab es einen erneuten Kauf oder eine Rückkehr unter die Sperrschwelle.':'Die Sperrschwelle wurde im beobachteten Zeitraum nicht erreicht.') :
   'Eine Schwellenüberschreitung allein beweist keine verhinderte Wiederanlage; dazu fehlen durchgehende Sperre und belegte Ablehnungen.';
 return {statusDays:counts,firstExitOnly,firstHalted,engineLatchDays:days.filter(d=>d.riskLatched).length,
  plannerBuyDays:days.filter(d=>d.plannerBuySignal).length,
  executedBuyDays:days.filter(d=>d.executedBuy).length,
  allCashDays:days.filter(d=>d.allCash).length,
  averageInvestedPct:days.length?days.reduce((n,d)=>n+d.investedPct,0)/days.length:0,
  years,exitOnlyRejections,cashLockedDays:cashLocked.length,firstCashLockedDay:cashLocked[0]?.day??null,
  lockFinding,lockEvidence};
}
export function diagnosticsMarkdown(trace:DiagnosticTrace,initialEquity:number):string[]{
 const result=analyzeDiagnosticTrace(trace,initialEquity);
 const percent=(n:number)=> (n*100).toFixed(2)+' %',total=trace.days.length;
 const ratio=(n:number)=>total?percent(n/total):'n/a';
 const lines=['## Diagnose: Entscheidungs- und Ausführungsengpässe','',
  'Die Zähleinheiten unterscheiden sich: Broker/RiskEngine = abgewiesene Orders; Coin-Qualität und fehlende Mengenregeln = gesperrte Markt-Tage (vor dem Planer) plus explizit abgewiesene Kaufversuche; Planer = Tage ohne Kaufsignal. Keine addierbare Gesamtzahl.',''];
 for(const source of ['broker','portfolioRisk','coinQuality','missingLot','planner'] as const){
  const label={broker:'Broker',portfolioRisk:'Portfolio-RiskEngine',coinQuality:'Coin-Qualität',
   missingLot:'Fehlende Mengenregel',planner:'Planer'}[source];
  const entries=Object.entries(trace.reasons[source]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  lines.push('### '+label+' – Top 15','', '| Grund | Anzahl |','|---|---:|',
   ...entries.slice(0,15).map(([reason,n])=>'| '+reason.replace(/\|/g,'/').replace(/\n/g,' ')+' | '+n+' |'),
   ...(entries.length?[]:['| Keine erfassten Ablehnungen | 0 |']),'');
 }
 lines.push('### RiskEngine-Status und Kaufaktivität','',
  'Status = passiv aus Tages-Drawdown und beobachteter Hard-Stop-Latch abgeleitete Risikoschwelle. Die Engine wird tatsächlich nur bei Kaufanfragen ausgewertet; das ist kein fiktiver Engine-Aufruf.','',
  '| Status | Tage | Anteil |','|---|---:|---:|',
  ...(['ok','caution','exit-only','halted'] as const).map(s=>`| ${s} | ${result.statusDays[s]} | ${ratio(result.statusDays[s])} |`),'',
  `Erster Tag exit-only: ${result.firstExitOnly??'nie'}; erster Tag halted (Schwelle oder Latch): ${result.firstHalted??'nie'}; Tage mit tatsächlich gesetzter Hard-Stop-Latch: ${result.engineLatchDays}.`,'',
  `Kaufsignal des Planers: ${result.plannerBuyDays}/${total} Tage (${ratio(result.plannerBuyDays)}); ausgeführter Kauf: ${result.executedBuyDays}/${total} Tage (${ratio(result.executedBuyDays)}). Fills erfolgen zeitlich nach der Entscheidung, die Tage sind daher nicht paarweise gleichzusetzen.`,'',
  `Durchschnittlich investiert (Marktwert/Equity): ${percent(result.averageInvestedPct)}; vollständig Cash: ${result.allCashDays}/${total} Tage (${ratio(result.allCashDays)}).`,'',
  '### Entwicklung nach Kalenderjahr (USDT)','',
  '| Jahr | Start-Equity | End-Equity | Jahresrendite | Jahres-Max-Drawdown | globaler Drawdown am Jahresende | Durchschnitt investiert | Cash-Tage |',
  '|---|---:|---:|---:|---:|---:|---:|---:|',
  ...result.years.map(y=>`| ${y.year} | ${y.startEquity.toFixed(2)} | ${y.endEquity.toFixed(2)} | ${percent(y.returnPct)} | ${percent(y.maxDrawdownPct)} | ${percent(y.endDrawdownPct)} | ${percent(y.averageInvestedPct)} | ${y.cashDays}/${y.days} |`),'',
  '### Prüfung des vermuteten Drawdown/Cash-Locks','',
  `**Befund: ${result.lockFinding}.** ${result.lockEvidence}`,
  `Belege: ${result.exitOnlyRejections} tatsächlich abgelehnte Käufe wegen Exit-only; ${result.cashLockedDays} Cash-Tage bei Exit-only/Halted; erster solcher Cash-Tag: ${result.firstCashLockedDay??'nie'}.`,'',
  'Die Zahl fehlender aktueller Mengenregeln ist eine Snapshot-Abdeckung, kein Beleg für 188 profitable, verpasste Trades. Markt-Tage ohne Filter sind keine tatsächlich abgewiesenen Kauforders.','');
 return lines;
}
