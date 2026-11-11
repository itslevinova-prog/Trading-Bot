import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DAY, importZip, openArchive, updateRegimes, type ArchiveDb} from '../src/archive/store.js';
import {qualityReport} from '../src/archive/report.js';

let db: ArchiveDb;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(),'archive-report-'));
  db = openArchive(join(root,'binance-spot-archive.db'));
});
afterEach(() => {db.close();rmSync(root,{recursive:true,force:true});});

describe('Archive quality and regimes (offline)', () => {
  it('detects missing hours and tracks independently imported daily/hourly parity', () => {
    const hourZip = 'BTCUSDT-1h-2024-01.zip';
    const dayZip = 'BTCUSDT-1d-2024-01.zip';
    for (const [name,minutes] of [[hourZip,60],[dayZip,1440]] as const) {
      const zip = readFileSync(new URL('./fixtures/archive/'+name,import.meta.url));
      const checksum = readFileSync(new URL('./fixtures/archive/'+name+'.CHECKSUM',import.meta.url),'utf8');
      importZip(db,name,zip,checksum,minutes);
    }
    let report = qualityReport(db,join(root,'binance-spot-archive.db'));
    expect(report.symbols).toBe(1);
    expect(report.candles).toBe(25);
    expect(report.dailyParity).toEqual({checked:1,mismatches:0});
    expect(report.gaps).toEqual([]);
    db.prepare('DELETE FROM candles WHERE symbol=? AND interval_min=60 AND ts=?')
      .run('BTCUSDT',Date.UTC(2024,0,1,12));
    report = qualityReport(db,join(root,'binance-spot-archive.db'));
    expect(report.dailyParity.checked).toBe(0);
    expect(report.gaps).toEqual([{symbol:'BTCUSDT',intervalMin:60,month:'2024-01',missing:1}]);
  });
  it('creates regime labels only from already observed daily closes', () => {
    const at=Date.UTC(2022,0,1);
    const insert=db.prepare('INSERT INTO candles(symbol,interval_min,ts,open,high,low,close,volume,quote_volume,trades) VALUES (?,?,?,100,105,95,?,1,100,1)');
    for(let i=0;i<230;i++) insert.run('BTCUSDT',1440,at+i*DAY,100+i);
    expect(updateRegimes(db)).toBe(230);
    const records=db.prepare('SELECT date,btc_above_200d AS above,btc_vol_30d_percentile AS percentile FROM regimes ORDER BY date').all() as
      {date:string;above:number|null;percentile:number|null}[];
    expect(records).toHaveLength(230);
    expect(records[0]?.above).toBeNull();
    expect(records[29]?.percentile).toBeNull();
    expect(records[199]?.above).toBe(1);
    expect(records[30]?.percentile).not.toBeNull();
  });
});
