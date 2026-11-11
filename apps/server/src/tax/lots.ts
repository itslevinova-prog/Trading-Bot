import type {TaxTrade,TaxMethod} from './ledger.js';

export type LotPart = {buyTradeId:string;qty:number;costBasis:number;holdingDays:number};
export type RealizedGain = {sellTradeId:string;accountId:string;pair:string;ts:number;qty:number;proceeds:number;costBasis:number;gain:number;holdingDays:number;lotsUsed:LotPart[];storedPnl:number|null;difference:number|null;reconciled:boolean};
type Lot = {id:string;ts:number;qty:number;basis:number};
const key=(t:TaxTrade)=>t.accountId+'|'+t.pair;

/** Replay all trades up to the report cutoff (not just trades in the requested year). */
export function calculateGains(trades:TaxTrade[],method:TaxMethod='fifo'):RealizedGain[] {
  if(method!=='fifo'&&method!=='average')throw Error('Ungültige Kostenbasis-Methode');
  const queues=new Map<string,Lot[]>(),out:RealizedGain[]=[];
  for(const t of [...trades].sort((a,b)=>a.ts-b.ts||a.id.localeCompare(b.id,'en'))){
    if(!(t.qty>0)||!(t.costEur>=0)||!(t.feeEur>=0))throw Error('Ungültige Trade-Beträge: '+t.id);
    const k=key(t),queue=queues.get(k)??[];queues.set(k,queue);
    if(t.side==='buy'){queue.push({id:t.id,ts:t.ts,qty:t.qty,basis:t.costEur+t.feeEur});continue;}
    if(t.side!=='sell')throw Error('Unbekannte Richtung: '+t.id);
    const available=queue.reduce((n,l)=>n+l.qty,0);
    if(available+1e-9<t.qty)throw Error('Verkauf ohne ausreichende Kauf-Lots: '+t.id);
    const parts:LotPart[]=[];
    let left=t.qty,used=0,weightedDays=0;
    const totalQty=queue.reduce((n,l)=>n+l.qty,0);
    // Average: sell the same fraction of every open acquisition lot.
    const consumption=method==='average'?queue.map(l=>t.qty*l.qty/totalQty):queue.map(l=>Math.min(left,l.qty));
    for(let i=0;i<queue.length;i++){
      const lot=queue[i]!,take=method==='average'?consumption[i]!:Math.min(left,lot.qty);
      if(take<=0)continue;
      const basis=lot.basis*(take/lot.qty);
      const days=(t.ts-lot.ts)/86400000;
      if(days<0)throw Error('Verkauf vor Kauf: '+t.id);
      parts.push({buyTradeId:lot.id,qty:take,costBasis:basis,holdingDays:days});
      lot.qty-=take;lot.basis-=basis;left-=take;used+=basis;weightedDays+=days*take;
    }
    if(Math.abs(left)>1e-7)throw Error('Lot-Abgleich fehlgeschlagen: '+t.id);
    queues.set(k,queue.filter(l=>l.qty>1e-10));
    const proceeds=t.costEur-t.feeEur,gain=proceeds-used;
    const difference=t.realizedPnlEur===null?null:gain-t.realizedPnlEur;
    out.push({sellTradeId:t.id,accountId:t.accountId,pair:t.pair,ts:t.ts,qty:t.qty,proceeds,costBasis:used,
      gain,holdingDays:weightedDays/t.qty,lotsUsed:parts,storedPnl:t.realizedPnlEur,
      difference,reconciled:difference!==null&&Math.abs(difference)<=1e-6});
  }
  return out;
}
