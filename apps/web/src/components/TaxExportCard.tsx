import {useState} from 'react';
import {Download} from 'lucide-react';

export function TaxExportCard(){
  const [year,setYear]=useState(new Date().getFullYear());
  const [currency,setCurrency]=useState<'CHF'|'EUR'>('CHF');
  const [method,setMethod]=useState<'fifo'|'average'>('fifo');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function download(){
    setBusy(true);setError('');
    try{
      const query=new URLSearchParams({year:String(year),currency,method});
      const response=await fetch('/api/export/tax?'+query.toString());
      if(!response.ok){
        const body=await response.json().catch(()=>({error:'Export nicht verfügbar'})) as {error?:string};
        throw Error(body.error??'Export nicht verfügbar');
      }
      const blob=await response.blob(),url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;link.download='tax-'+year+'-all-'+currency+'-paper.zip';
      document.body.appendChild(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e instanceof Error?e.message:'Export fehlgeschlagen');}
    finally{setBusy(false);}
  }
  return <section className="card" aria-label="Export für Steuer">
    <h2>Export für Steuer</h2>
    <p className="muted text-sm my-3">Paper-Daten (Spielgeld), keine Steuerberatung. Nur lokaler Download, Wechselkurse ausschliesslich von der EZB.</p>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-sm">Jahr
        <select className="input block mt-1" value={year} onChange={e=>setYear(Number(e.target.value))}>
          {Array.from({length:7},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className="text-sm">Zielwährung
        <select className="input block mt-1" value={currency} onChange={e=>setCurrency(e.target.value as 'CHF'|'EUR')}>
          <option value="CHF">CHF</option><option value="EUR">EUR</option>
        </select>
      </label>
      <label className="text-sm">Kostenbasis
        <select className="input block mt-1" value={method} onChange={e=>setMethod(e.target.value as 'fifo'|'average')}>
          <option value="fifo">FIFO</option><option value="average">Durchschnitt</option>
        </select>
      </label>
      <button type="button" className="btn btn-accent flex items-center gap-2" onClick={()=>void download()} disabled={busy}>
        <Download size={16}/>{busy?'Erstelle Export…':'ZIP herunterladen'}
      </button>
    </div>
    {error&&<p className="negative text-sm mt-3" role="alert">{error}</p>}
  </section>;
}
