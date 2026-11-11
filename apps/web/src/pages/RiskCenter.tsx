import {useEffect,useState} from 'react';
import {AlertTriangle,Activity,ShieldAlert,ShieldCheck,TrendingDown,RefreshCcw,Scale} from 'lucide-react';
import {type Account,get,money,num,pct,time} from '../api';
type Summary={accountId:string;name:string;status:string;trades:number;closedTrades:number;winRatePct:number|null;profitFactor:number|null;realizedPnlEur:number;feesEur:number;turnoverEur:number;avgSlippageBps:number|null;maxDrawdownPct:number|null;currentDrawdownPct:number|null;largestLossEur:number|null;dataPoints:number;insufficientSample:boolean};
type PortfolioRiskRecord={accountId:string;name:string;status:string;latched:boolean;current:{
 asOf:number;dataReady:boolean;investedPct:number|null;
 portfolioVol:number|null;btcBeta:number|null;clusterPct:number|null;
 drawdown:number|null;toCaution:number|null;toExitOnly:number|null;toHardStop:number|null
}|null;last:{
 pair:string;ts:number;requested:number;approved:number;allowed:number;state:string;reasons:string;
 portfolioVol:number|null;btcBeta:number|null;clusterPct:number|null;drawdown:number
}|null};
type PortfolioRiskPayload={paperOnly:boolean;asOf:number;limits:{targetAnnualVol:number;maxClusterPct:number;maxPortfolioBeta:number;maxPositionPct:number};accounts:PortfolioRiskRecord[];note:string};
type Health={protectiveExitFailures?:number;connected:boolean;checkedAt:number;paperOnly:boolean;pairs:number;freshBooks:number;readyFeatures:number;staleBooks:number;trackedAccounts:number;rejections24h:number;lastTradeAt:number|null;feeRate:number;disclaimer:string};
const Tile=({name,value,description}:{name:string;value:string;description?:string})=><div className="metric-tile"><p className="stat-label">{name}</p><p className="stat-number mt-2">{value}</p>{description&&<p className="hint mt-2">{description}</p>}</div>;
export function RiskCenter({accounts}:{accounts:Account[]}){
 const [portfolioRisk,setPortfolioRisk]=useState<PortfolioRiskPayload|null>(null);
 const [stats,setStats]=useState<Summary[]>([]),[health,setHealth]=useState<Health|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=async()=>{setLoading(true);try{const [s,h,r]=await Promise.all([get<Summary[]>('/analytics'),get<Health>('/health'),get<PortfolioRiskPayload>('/portfolio-risk')]);setStats(s);setHealth(h);setPortfolioRisk(r);setError('')}catch(e){setError(String(e))}finally{setLoading(false)}};
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return ()=>clearInterval(timer)},[]);
 return <div className="space-y-5">
  <div className="research-hero"><p className="uppercase tracking-[.16em] text-xs font-bold text-[#61d1b5] flex items-center gap-2"><ShieldCheck size={16}/> Risk & Execution Intelligence</p><h2 className="text-2xl font-bold mt-3">Risiken zuerst sichtbar machen.</h2><p className="text-sm leading-6 text-[#a8b8cb] max-w-3xl mt-2">Überwache Datenqualität, Gebühren, Trading-Verluste und Drawdowns aller Paper-Konten. Eine hohe Trefferquote allein sagt nichts über zukünftige Gewinne aus.</p></div>
  <div className="flex justify-between items-center"><h2 className="text-lg font-bold">Systemgesundheit</h2><button className="btn inline-flex items-center gap-2" onClick={()=>void load()} disabled={loading}><RefreshCcw size={15} className={loading?'animate-spin':''}/> Aktualisieren</button></div>
  {error&&<div className="warning-strip"><AlertTriangle size={17}/> {error}</div>}
  <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3"><Tile name="Börsenverbindung" value={health?(health.connected?'Aktiv':'Offline'):'–'} description="Öffentliche Marktdaten"/><Tile name="Frische Orderbücher" value={health?`${health.freshBooks}/${health.pairs}`:'–'} description="Nur geprüfte Bücher freigegeben"/><Tile name="Indikatoren bereit" value={health?`${health.readyFeatures}/${health.pairs}`:'–'} description="15-Minuten- und 60-Minuten-Daten"/><Tile name="Abgelehnte Orders / 24h" value={health?num(health.rejections24h,0):'–'} description="Limits oder Datenqualität"/></div>
  {!!health?.protectiveExitFailures&&<div className="warning-strip"><ShieldAlert size={18}/> {health.protectiveExitFailures} simulierte Schutzverkäufe sind noch offen oder fehlgeschlagen. Betroffene Konten bleiben für neue Käufe gesperrt. Der ausgelöste Schutzverkauf wird mit Abstand bei neuen gültigen Kursen erneut versucht.</div>}
  {health&&(health.staleBooks>0||!health.connected)&&<div className="warning-strip"><ShieldAlert size={18}/> {health.staleBooks} von {health.pairs} Orderbüchern sind veraltet oder nicht bereit. Simulierte Orders werden bei veralteten Daten abgelehnt.</div>}
  {portfolioRisk&&<div className="card">
   <h2 className="mb-2">Portfolio-RiskEngine – letzte Einstiegskontrolle</h2>
   <p className="hint mb-4">Zielvolatilität {num(portfolioRisk.limits.targetAnnualVol*100)} % · BTC-Beta max. {num(portfolioRisk.limits.maxPortfolioBeta)} · Hoch-Beta-Cluster max. {num(portfolioRisk.limits.maxClusterPct*100)} % des Kapitals. Nur geschlossene Kerzen; keine Gewinnprognose.</p>
   <h3 className="text-sm font-semibold mb-2">Aktuelle Portfoliowerte (nur bei vollständiger Datengrundlage)</h3>
   <div className="table-shell mb-5"><table className="table"><thead><tr><th>Konto</th><th>Investiert</th><th>Portfolio-Vola</th><th>BTC-Beta</th><th>Cluster</th><th>Drawdown</th><th>Bis Vorsicht / Ausstiegsstopp / Hardstop</th></tr></thead>
   <tbody>{portfolioRisk.accounts.map(a=><tr key={a.accountId}>
    <td>{a.name}</td>
    <td>{a.current?.investedPct==null?'–':num(a.current.investedPct*100)+' %'}</td>
    <td>{a.current?.dataReady&&a.current.portfolioVol!=null?num(a.current.portfolioVol*100)+' %':'Unbekannt'}</td>
    <td>{a.current?.dataReady&&a.current.btcBeta!=null?num(a.current.btcBeta):'Unbekannt'}</td>
    <td>{a.current?.dataReady&&a.current.clusterPct!=null?num(a.current.clusterPct*100)+' %':'Unbekannt'}</td>
    <td>{a.current?.drawdown==null?'–':num(a.current.drawdown*100)+' %'}</td>
    <td>{a.current?.toCaution==null?'–':num(a.current.toCaution*100)+' / '+num(a.current.toExitOnly!*100)+' / '+num(a.current.toHardStop!*100)+' %-Punkte'}</td>
   </tr>)}</tbody></table></div>
   <p className="hint mb-4">Fehlende Historie, veraltete Kurse oder ein Verbindungsfehler werden nicht als Nullrisiko ausgegeben. Werte sind nur eine lesende Diagnose, keine Einstiegserlaubnis.</p>
   <h3 className="text-sm font-semibold mb-2">Letzte Einstiegskontrolle (historisches Prüfprotokoll)</h3>
   <div className="table-shell"><table className="table"><thead><tr><th>Konto</th><th>Schutz</th><th>Letzter Entscheid</th><th>Portfolio-Vola</th><th>BTC-Beta</th><th>Cluster</th><th>Grund</th></tr></thead>
   <tbody>{portfolioRisk.accounts.map(a=><tr key={a.accountId}>
    <td>{a.name}</td><td>{a.latched?'Hardstop eingerastet':a.last?.state??'Noch keine Messung'}</td>
    <td>{a.last?(a.last.allowed?'Verkleinert/freigegeben':'Gesperrt'):'–'}</td>
    <td>{a.last?.portfolioVol==null?'–':num(a.last.portfolioVol*100)+' %'}</td>
    <td>{a.last?.btcBeta==null?'–':num(a.last.btcBeta)}</td>
    <td>{a.last?.clusterPct==null?'–':num(a.last.clusterPct*100)+' %'}</td>
    <td className="text-xs">{a.last?.reasons||'Ohne vollständige Risikohistorie kein Messwert'}</td>
   </tr>)}</tbody></table></div>
   <p className="hint mt-3">Bei 15 % Drawdown bleibt die Sperre auch nach einem Neustart erhalten. Aufhebung nur über lokalen CLI-Befehl und protokollierte Bestätigung; alle anderen Checks bleiben aktiv.</p>
  </div>}
  <div className="grid lg:grid-cols-3 gap-4">{accounts.map(a=>{const s=stats.find(x=>x.accountId===a.id);const hasLoss=(s?.realizedPnlEur??0)<0;return <div className="card" key={a.id}><div className="flex items-center justify-between gap-3 mb-4"><h2 className="mb-0">{a.name}</h2><span className="badge">{a.status}</span></div><div className="flex justify-between gap-3 items-end"><div><p className="stat-label">Aktueller Kontowert</p><p className="stat-number mt-1">{money(a.equity)}</p></div><div className={a.pnlPct!==null&&a.pnlPct>=0?'positive':'negative'}>{pct(a.pnlPct)}</div></div><div className="grid grid-cols-2 gap-x-3 gap-y-5 mt-5 pt-5 border-t border-[#2a3b50]">{[['Aktueller Drawdown',`${num(a.drawdownPct)} %`],['Grösster Drawdown',s?.maxDrawdownPct===null?'–':`${num(s?.maxDrawdownPct??0)} %`],['Realisierter Gewinn/Verlust',s?money(s.realizedPnlEur):'–'],['Gebühren gesamt',s?money(s.feesEur):'–'],['Geschlossene Verkäufe',String(s?.closedTrades??0)],['Trefferquote',s?.winRatePct==null?'–':`${num(s.winRatePct)} %`]].map(([k,v])=><div key={k}><p className="stat-label">{k}</p><p className={`font-bold text-sm mt-1 ${k==='Realisierter Gewinn/Verlust'?(hasLoss?'negative':'positive'):''}`}>{v}</p></div>)}</div><div className="mt-5 pt-4 border-t border-[#2c3e51] text-xs text-[#9bb0c5] flex items-center gap-2">{s?.insufficientSample?<AlertTriangle size={14} className="text-[#edbb6d]"/>:<ShieldCheck size={14} className="text-[#57c9ae]"/>}{s?.insufficientSample?'Weniger als 20 geschlossene Verkäufe – zu wenig Daten':'Historische Kennzahlen, keine Prognose'}</div></div>})}</div>
  <div className="grid lg:grid-cols-2 gap-5"><div className="card"><h2 className="flex items-center gap-2"><Scale size={19} className="text-[#60d3b5]"/> Handelskosten im Vergleich</h2><div className="space-y-5">{stats.map(s=><div key={s.accountId}><div className="flex justify-between gap-3 text-sm mb-2"><span className="muted">{s.name}</span><strong>{money(s.feesEur)} Gebühren</strong></div><div className="h-2 rounded-lg bg-[#23364b] overflow-hidden"><div className="h-full bg-[#55c9ab] rounded-lg" style={{width:`${Math.min(100,s.turnoverEur?Math.max(2,s.feesEur/s.turnoverEur/0.02*100):0)}%`}}/></div><div className="flex justify-between mt-2 hint"><span>Umsatz: {money(s.turnoverEur)}</span><span>Ø Slippage: {s.avgSlippageBps==null?'–':num(s.avgSlippageBps)} bps</span></div></div>)}</div></div><div className="card"><h2 className="flex items-center gap-2"><TrendingDown size={19} className="text-[#f0b772]"/> Risikohinweise</h2><div className="space-y-3 text-sm text-[#b2c0d1]"><div className="info-step"><span className="step-mark">01</span><p>Stop-Loss begrenzt nicht garantiert den Verlust: Kurslücken und Orderbuchliquidität beeinflussen den Fill.</p></div><div className="info-step"><span className="step-mark">02</span><p>Bei nur 100 € Startkapital sind Gebühren relativ teuer. Viele kleine Trades können die Rendite deutlich belasten.</p></div><div className="info-step"><span className="step-mark">03</span><p>Historisch profitable Muster können in anderen Marktphasen scheitern. Nutze das Strategie-Labor zum Gegenprüfen.</p></div><div className="info-step"><span className="step-mark">04</span><p>Diese App führt ausschliesslich fiktive Orders aus. Sie ist keine Empfehlung für reale Transaktionen.</p></div></div></div></div>
  <p className="hint"><Activity size={13} className="inline-block mr-1"/> Letzte Datenprüfung: {health?time(health.checkedAt):'–'} · Letzter simulierter Trade: {health?.lastTradeAt?time(health.lastTradeAt):'keiner'} · Standard-Takergebühr: {health?num(health.feeRate*100):'–'} %.</p>
 </div>;
}
