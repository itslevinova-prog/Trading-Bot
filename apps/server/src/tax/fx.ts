import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import type {TaxCurrency} from './ledger.js';

const ECB_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';
const SOURCE='EZB eurofxref-hist.zip';
export type FxTable = Map<string,Map<string,number>>;
export type FxResult = {fxRate:number;fxDate:string;fxSource:string;fxNote:string;quote:string;target:TaxCurrency};
export const dateInZurich=(ts:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(ts);

export function ecbCsvFromZip(bytes:Buffer):string {
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(bytes.readUInt32LE(p)===0x06054b50){end=p;break;}
  if(end<0)throw Error('EZB-ZIP: Endverzeichnis fehlt');
  const n=bytes.readUInt16LE(end+10);
  let pos=bytes.readUInt32LE(end+16);
  for(let i=0;i<n;i++){
    if(bytes.readUInt32LE(pos)!==0x02014b50)throw Error('EZB-ZIP: ungültiges Verzeichnis');
    const method=bytes.readUInt16LE(pos+10),size=bytes.readUInt32LE(pos+20),
      len=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),
      local=bytes.readUInt32LE(pos+42);
    const name=bytes.toString('utf8',pos+46,pos+46+len);
    pos+=46+len+extra+comment;
    if(!/eurofxref-hist\.csv$/i.test(name))continue;
    if(bytes.readUInt32LE(local)!==0x04034b50)throw Error('EZB-ZIP: Dateiheader fehlt');
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    if(size>10000000||start+size>bytes.length)throw Error('EZB-ZIP: Dateigrösse ungültig');
    const raw=bytes.subarray(start,start+size);
    if(method===0)return raw.toString('utf8');
    if(method===8)return inflateRawSync(raw,{maxOutputLength:10000000}).toString('utf8');
    throw Error('EZB-ZIP: unbekannte Komprimierung');
  }
  throw Error('EZB-ZIP enthält keine historischen Referenzkurse');
}

export function parseEcbCsv(text:string):FxTable {
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  const headers=lines.shift()?.split(',').map(s=>s.trim())??[];
  if(headers[0]!=='Date'||!headers.includes('CHF')||!headers.includes('USD'))throw Error('EZB-Kursdatei ohne Date, CHF oder USD');
  const rates:FxTable=new Map();
  for(const line of lines){
    const items=line.split(',').map(s=>s.trim()),date=items[0];
    if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
    const record=new Map<string,number>([['EUR',1]]);
    for(let i=1;i<headers.length;i++){
      const value=Number(items[i]);
      if(items[i]&&Number.isFinite(value)&&value>0)record.set(headers[i]!,value);
    }
    rates.set(date,record);
  }
  if(!rates.size)throw Error('EZB-Kursdatei enthält keine gültigen Kurse');
  return rates;
}

export async function loadEcbRates(root:string,allowDownload=true):Promise<FxTable> {
  const path=resolve(root,'data/fx/eurofxref-hist.zip');
  let bytes:Buffer;
  try{bytes=await readFile(path);}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    if(!allowDownload)throw Error('EZB-Wechselkurs-Cache fehlt: data/fx/eurofxref-hist.zip (kein Netzwerk)');
    let response:Response;
    try{response=await fetch(ECB_URL,{signal:AbortSignal.timeout(15000)});}
    catch{throw Error('EZB nicht erreichbar; Cache data/fx/eurofxref-hist.zip fehlt');}
    if(!response.ok)throw Error('EZB-Download fehlgeschlagen: HTTP '+response.status);
    const body=Buffer.from(await response.arrayBuffer());
    if(body.length>10000000)throw Error('EZB-Download überschreitet 10 MB');
    // Validate before writing anything.
    parseEcbCsv(ecbCsvFromZip(body));
    await mkdir(resolve(root,'data/fx'),{recursive:true});
    await writeFile(path,body,{flag:'wx'}).catch(async e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
    bytes=await readFile(path);
  }
  return parseEcbCsv(ecbCsvFromZip(bytes));
}
export function convertFx(rates:FxTable,amount:number,quote:string,target:TaxCurrency,date:string):FxResult & {amount:number} {
  const approximate=quote==='USDT'||quote==='USDC';
  const source=approximate?'USD':quote;
  const note=approximate?quote+'≈USD (Stablecoin-Parität angenommen)':'';
  if(source===target)return {fxRate:1,fxDate:date,fxSource:'Währungsidentität',fxNote:note,quote,target,amount};
  const latest=[...rates.keys()].filter(d=>d<=date).sort().at(-1);
  if(!latest)throw Error('Kein EZB-Kurs am oder vor '+date);
  const row=rates.get(latest)!,from=row.get(source),to=row.get(target);
  if(!from||!to)throw Error('EZB-Kurs '+source+'/'+target+' fehlt am '+latest);
  const rate=to/from;
  return {fxRate:rate,fxDate:latest,fxSource:SOURCE,fxNote:note,quote,target,amount:amount*rate};
}
