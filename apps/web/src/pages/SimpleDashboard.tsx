import {useEffect,useMemo,useState} from 'react';
import type {Account,Decision,Position,Snapshot,Trade} from '../api';
import {get,money,num,pct,time} from '../api';
import {changeSince,getSimpleStatus,observedMaxDrop,type HealthSignal,type RiskSignal} from './simple-dashboard-data';

type Props={
 accounts:Account[];positions:Position[];trades:Trade[];decisions:Decision[];
 equity:Snapshot[];connected:boolean;error:string;now:number;
};
const DAY=86_400_000;
const lightStyles={
 red:{border:'border-red-600/70',background:'bg-red-950/40',dot:'bg-red-400',symbol:'🔴'},
 yellow:{border:'border-amber-500/70',background:'bg-amber-950/30',dot:'bg-amber-300',symbol:'🟡'},
 green:{border:'border-emerald-500/70',background:'bg-emerald-950/30',dot:'bg-emerald-300',symbol:'🟢'}
};
function MoneyChange({value,percent}:{value:number;percent:number|null}) {
 return <span className={value>=0?'positive':'negative'}>{value>0?'+':''}{money(value)} · {pct(percent)}</span>;
}
function reasonForTrade(trade:Trade) {
 const reason=trade.reason.toLowerCase();
 if(reason.includes('dca'))return 'Regelmässiger Sparplan';
 if(reason.includes('stop'))return 'Automatischer Schutzverkauf';
 if(reason.includes('take profit'))return 'Geplanter Gewinnverkauf';
 return 'Der genaue Grund steht in der Expertenansicht.';
}
export function SimpleDashboard({accounts,positions,trades,decisions,equity,connected,error,now}:Props) {
 const [selectedId,setSelectedId]=useState('');
 const [health,setHealth]=useState<HealthSignal|null>(null);
 const [risk,setRisk]=useState<RiskSignal|null>(null);
 const [monitorError,setMonitorError]=useState('');
 const [profile,setProfile]=useState<'safe'|'risky'|null>(null);
 const account=accounts.find(a=>a.id===selectedId)??accounts.find(a=>a.id==='rules')??
  accounts.find(a=>a.strategy!=='hold'&&a.strategy!=='dca')??accounts[0];
 useEffect(()=>{
  let active=true;
  const check=async()=>{
   try{
    const [h,r]=await Promise.all([get<HealthSignal>('/health'),get<RiskSignal>('/portfolio-risk')]);
    if(active){setHealth(h);setRisk(r);setMonitorError('');}
   }catch(e){if(active){setHealth(null);setRisk(null);setMonitorError(e instanceof Error?e.message:String(e));}}
  };
  void check();const timer=window.setInterval(()=>void check(),7000);
  return ()=>{active=false;window.clearInterval(timer);};
 },[]);
 useEffect(()=>{
  let active=true;
  setProfile(null);
  if(account?.strategy==='ai')void get<{policy:{mode:string}}>(`/accounts/${account.id}/trading-policy`)
   .then(r=>{if(active)setProfile(r.policy.mode==='safe'?'safe':r.policy.mode==='risky'?'risky':null);})
   .catch(()=>{if(active)setProfile(null);});
  return ()=>{active=false;};
 },[account?.id,account?.strategy]);
 const light=getSimpleStatus({serverError:error,connected,health,risk,now});
 const style=lightStyles[light.color];
 const changes=useMemo(()=>account?{
  day:changeSince(equity,account.id,now,DAY,account.equity),
  week:changeSince(equity,account.id,now,7*DAY,account.equity),
  maxDrop:observedMaxDrop(equity,account.id)
 }:null,[equity,account,now]);
 const recent=trades.filter(t=>t.accountId===account?.id).slice(0,5);
 const open=positions.filter(p=>p.accountId===account?.id);
 const latestDecision=decisions.find(d=>d.accountId===account?.id);
 const dca=accounts.find(a=>a.strategy==='dca');
 const hold=accounts.find(a=>a.strategy==='hold');
 return <div className="mx-auto max-w-5xl w-full min-w-0 space-y-5">
  <section aria-live="polite" className={`rounded-2xl border-2 p-5 sm:p-7 ${style.border} ${style.background}`}>
   <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">So läuft es gerade</p>
   <div className="flex items-start gap-3"><span aria-hidden="true" className="text-3xl">{style.symbol}</span>
    <div className="min-w-0"><h1 className="text-xl sm:text-2xl font-bold">{light.title}</h1>
     <p className="mt-2 text-slate-200 text-sm leading-6">{light.reason}</p></div>
   </div>
   {monitorError&&<p className="mt-3 text-sm text-amber-200">Zusätzliche Prüfung nicht erreichbar: {monitorError}</p>}
   <p className="text-xs text-slate-400 mt-4">Stand: {health?time(health.checkedAt):'nicht verfügbar'} · Keine Aussage über künftige Gewinne</p>
  </section>
  <section className="card space-y-4">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <h2 className="!mb-0">Mein Spielgeld-Konto</h2>
    <label className="text-sm text-slate-300">Konto auswählen
     <select aria-label="Konto auswählen" className="input block mt-1 max-w-full" value={account?.id??''}
      onChange={e=>setSelectedId(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
    </label>
   </div>
   {account?<><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
    <div className="metric-tile"><p className="stat-label">Wert jetzt</p>
     <p className="text-2xl font-bold mt-2 break-words">{money(account.equity)}</p>
     {!account.valuation.complete&&<p className="text-xs text-amber-200 mt-2">Nicht alle Münzen konnten bewertet werden.</p>}
    </div>
    <div className="metric-tile"><p className="stat-label">Seit heute vor 24 Stunden</p><p className="mt-2 font-semibold break-words">{changes?.day?<MoneyChange {...changes.day}/>: 'Noch nicht genügend Werte'}</p></div>
    <div className="metric-tile"><p className="stat-label">Seit einer Woche</p><p className="mt-2 font-semibold break-words">{changes?.week?<MoneyChange {...changes.week}/>: 'Noch nicht genügend Werte'}</p></div>
    <div className="metric-tile"><p className="stat-label">Seit Kontostart, ohne Einzahlungen</p>
     <p className="mt-2 font-semibold break-words">{account.pnlEur!==null?<MoneyChange value={account.pnlEur} percent={account.pnlPct}/>: 'Nicht verfügbar'}</p>
    </div>
   </div>
   <p className="hint">Die Tages- und Wochenänderung zeigt den Kontowert inklusive möglicher Einzahlungen – nicht die reine Rendite.</p>
   <div className="grid sm:grid-cols-3 gap-3 text-sm">
    <p>Aktuell unter dem bisherigen Höchststand: <strong>{pct(account.drawdownPct)}</strong></p>
    <p title="Wie stark der gemessene Kontowert vom zwischenzeitlichen Höchststand gesunken ist.">Grösster gemessener Rückgang: <strong>{pct(changes?.maxDrop??null)}</strong></p>
    <p>Vorsichts-Einstellung: <strong>{profile==='safe'?'Vorsichtig':profile==='risky'?'Erhöhtes Risiko':'Nicht hinterlegt'}</strong></p>
   </div>
   </>:<p className="muted">Noch kein Konto vorhanden.</p>}
  </section>
  <section className="card space-y-3">
   <h2 className="!mb-0">Vergleich mit einfachen Alternativen</h2>
   <p className="hint">Ein fairer Vergleich mit gleichen Einzahlungen und Kosten ist noch nicht nachgewiesen. Die Werte unten sind nur getrennte Spielgeld-Konten, kein Nachweis, was besser wäre.</p>
   <div className="grid sm:grid-cols-2 gap-3">
    <div className="metric-tile"><p className="stat-label">Münzen einfach halten</p><p className="font-semibold mt-2 break-words">{hold?money(hold.equity):'Keine Daten vorhanden'}</p><p className="hint mt-1">Eigener Kontostand, nicht zwingend nur Bitcoin.</p></div>
    <div className="metric-tile"><p className="stat-label">Regelmässiger Sparplan</p><p className="font-semibold mt-2 break-words">{dca?money(dca.equity):'Keine Daten vorhanden'}</p><p className="hint mt-1">Separates Spielgeld-Konto, Einzahlungen können abweichen.</p></div>
   </div>
  </section>
  <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
   <div className="card min-w-0">
    <h2>Letzte Aktionen</h2>
    {recent.length?<ol className="space-y-3">{recent.map(t=><li key={t.id} className="border-b border-slate-700 pb-3 text-sm min-w-0">
     <p className="font-semibold break-words">{t.side==='buy'?'Gekauft':t.side==='sell'?'Verkauft':'Aktion'}: {t.pair.split('/')[0]} · {money(t.costEur)}</p>
     <p className="muted mt-1">{time(t.ts)} · {reasonForTrade(t)}</p>
    </li>)}</ol>:<p className="muted text-sm">Noch keine Käufe oder Verkäufe aufgezeichnet.</p>}
   </div>
   <div className="card min-w-0">
    <h2>Was liegt gerade im Konto?</h2>
    {open.length?<div className="space-y-3">{open.map(p=><div key={p.id} className="metric-tile">
     <p className="font-semibold">{p.pair.split('/')[0]}</p>
     <p className="text-sm mt-2">Wert: {money(p.value)} · Änderung: {pct(p.pnlPct)}</p>
     <p className="hint mt-1">Kaufdatum hier nicht zuverlässig verfügbar.</p>
    </div>)}</div>:<p className="muted text-sm">Zurzeit keine Münzen im ausgewählten Konto.</p>}
   </div>
  </section>
  <section className="card">
   <h2>Warum kauft der Bot gerade nichts?</h2>
   <p className="text-sm leading-6">{account?.status==='paused'
    ?'Dieses Konto wurde pausiert. Solange es pausiert ist, werden keine neuen Käufe ausgelöst.'
    :latestDecision
     ?'Letzte aufgezeichnete Entscheidung: '+time(latestDecision.ts)+'. Der genaue Grund für einen ausbleibenden Kauf ist hier nicht sicher erkennbar.'
     :'Noch keine Entscheidung vorhanden. Ein konkreter Grund lässt sich nicht aus den Daten ableiten.'}</p>
  </section>
  <p className="text-xs text-slate-400 pb-6">Nur Paper-Handel mit Spielgeld. Nicht verfügbare Daten werden nicht geschätzt. Für Einzelheiten die Expertenansicht öffnen.</p>
 </div>;
}
