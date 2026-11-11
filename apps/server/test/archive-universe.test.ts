import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArchive, DAY, type ArchiveDb} from '../src/archive/store.js';
import {ArchiveUniverse} from '../src/archive/universe.js';
import {alreadyVerified, downloadFile, filterObject, parseListing, processQueue, rawFilePath, type ArchiveObject} from '../src/archive/download.js';

let directory = '';
let db: ArchiveDb;
beforeEach(() => {directory = mkdtempSync(join(tmpdir(),'archive-tests-')); db = openArchive(join(directory,'archive.db'));});
afterEach(() => {db.close(); rmSync(directory,{recursive:true,force:true});});

describe('Point-in-time universe selection', () => {
  it('ranks exactly 30 historical daily quote-volume days, not future volume', () => {
    const date = Date.UTC(2022,5,1);
    const symbols = [['OLDUSDT','OLD',10],['BTCUSDT','BTC',5],['USDCUSDT','USDC',200],['ADAUPUSDT','ADAUP',300],['NEWUSDT','NEW',1000]] as const;
    const add = db.prepare('INSERT INTO candles(symbol,interval_min,ts,open,high,low,close,volume,quote_volume,trades) VALUES (?,?,?,1,1,1,1,1,?,1)');
    for (const [symbol,base,volume] of symbols) {
      const from = date - (symbol==='NEWUSDT' ? 29 : 30)*DAY;
      db.prepare('INSERT INTO symbols(symbol,base,quote,first_ts,last_ts) VALUES (?,?,?,?,?)').run(symbol,base,'USDT',from,date);
      for (let d=30;d>=1;d--) {
        const ts=date-d*DAY;
        if (ts < from) continue;
        add.run(symbol,1440,ts,volume);
      }
      // This date is not yet visible to the universeAt(date) query.
      add.run(symbol,1440,date,1e12);
    }
    const universe = new ArchiveUniverse(db).universeAt(date,{quote:'USDT',topN:20});
    expect(universe.map(i=>i.symbol)).toEqual(['OLDUSDT','BTCUSDT']);
    expect(universe[0]?.quoteVolume30d).toBe(300);
    expect(universe[1]?.quoteVolume30d).toBe(150);
  });
});

describe('Public downloader primitives: fully offline', () => {
  const item: ArchiveObject = {
    key:'data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2024-01.zip',
    symbol:'BTCUSDT', interval:'1h', date:'2024-01', size:578
  };
  it('recognises delisted symbols from public XML; excludes wrong intervals/quotes', () => {
    const xml = '<ListBucketResult><Contents><Key>data/spot/monthly/klines/OLDUSDT/1h/OLDUSDT-1h-2022-05.zip</Key><Size>500</Size></Contents><NextContinuationToken>page-2</NextContinuationToken></ListBucketResult>';
    const listing = parseListing(xml);
    expect(listing.continuation).toBe('page-2');
    expect(filterObject(listing.entries[0]!.key,500,'monthly',['1h'],'2020-01','2026-01',new Date('2026-11-05T00:00:00Z'))?.symbol).toBe('OLDUSDT');
    expect(filterObject(listing.entries[0]!.key,500,'monthly',['1d'],'2020-01','2026-01')).toBeUndefined();
  });
  it('resumes a previously downloaded verified ZIP without making a request', async () => {
    const path = rawFilePath(item,join(directory,'raw'));
    mkdirSync(join(directory,'raw','1h','BTCUSDT'),{recursive:true});
    copyFileSync(new URL('./fixtures/archive/BTCUSDT-1h-2024-01.zip',import.meta.url),path);
    copyFileSync(new URL('./fixtures/archive/BTCUSDT-1h-2024-01.zip.CHECKSUM',import.meta.url),path+'.CHECKSUM');
    expect(alreadyVerified(path)).toBe(true);
    const network = (async () => {throw Error('Network must not be called');}) as unknown as typeof fetch;
    expect(await downloadFile(item,join(directory,'raw'),network)).toBe('skipped');
  });
  it('rejects a checksum mismatch on every retry and never saves the invalid ZIP', async () => {
    const filename = 'BTCUSDT-1h-2024-01.zip';
    const checksum = readFileSync(new URL('./fixtures/archive/'+filename+'.CHECKSUM',import.meta.url),'utf8');
    let attempted = 0;
    const network = (async (url: string) => {
      if (url.endsWith('.CHECKSUM')) return {ok:true,status:200,text:async()=>checksum};
      attempted++;
      const corrupt = new Uint8Array([0,1,2,3]);
      return {ok:true,status:200,arrayBuffer:async()=>corrupt.buffer};
    }) as unknown as typeof fetch;
    await expect(downloadFile(item,join(directory,'raw'),network,async()=>undefined)).rejects.toThrow(/three attempts/);
    expect(attempted).toBe(3);
    expect(existsSync(rawFilePath(item,join(directory,'raw')))).toBe(false);
  });
  it('rejects more than four concurrent jobs', async () => {
    await expect(processQueue([1,2],async()=>undefined,5)).rejects.toThrow('Max 4');
  });
});
