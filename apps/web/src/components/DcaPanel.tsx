import {useEffect,useState} from 'react';
import {get,money,time} from '../api';
type Deposit={period:string;ts:number;amount:number};
type Decision={period:string;ts:number;variant:string;status:string;reason:string};
type DcaInfo={paperOnly:boolean;config:{interval:string;variant:string;allocation:string};deposits:Deposit[];decisions:Decision[]};
export function DcaPanel(){
 const [state,setState]=useState<DcaInfo|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  const refresh=()=>void get<DcaInfo>('/dca').then(result=>{if(active){setState(result);setError('');}}).catch(e=>{if(active)setError(String(e));});
  refresh();const timer=window.setInterval(refresh,30000);
  return ()=>{active=false;window.clearInterval(timer)};
 },[]);
 if(error)return <div className="warning-strip">DCA-Kontodaten momentan nicht verfügbar: {error}</div>;
 if(!state)return null;
 const contributed=state.deposits.reduce((sum,d)=>sum+d.amount,0);
 return <div className="card">
  <div className="flex items-center justify-between gap-3"><h2>DCA-Sparplan · simuliertes Konto</h2><span className="badge">Nur Spielgeld</span></div>
  <p className="hint mt-2">Regelmässige Einzahlungen sind kein Gewinn. Kein echtes Geld, keine automatische Live-Order.</p>
  <div className="grid md:grid-cols-4 gap-3 my-4">
   <div><p className="stat-label">Intervall</p><p className="font-semibold">{state.config.interval}</p></div>
   <div><p className="stat-label">Strategie</p><p className="font-semibold">{state.config.variant}</p></div>
   <div><p className="stat-label">BTC/ETH</p><p className="font-semibold">{state.config.allocation}</p></div>
   <div><p className="stat-label">Einzahlungen insgesamt</p><p className="font-semibold">{money(contributed)}</p></div>
  </div>
  {state.decisions.length>0?<div className="table-shell"><table className="table">
   <thead><tr><th>Periode</th><th>Datum</th><th>Entscheid</th><th>Hinweis</th></tr></thead>
   <tbody>{state.decisions.slice(0,5).map(d=><tr key={d.period}><td>{d.period}</td><td>{time(d.ts)}</td><td>{d.status}</td><td>{d.reason}</td></tr>)}</tbody>
  </table></div>:<p className="hint">Noch kein Simulationszyklus protokolliert.</p>}
 </div>;
}
