import {afterEach,describe,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {buildLedger,readIdentity,assertSingleNetwork} from '../src/tax/ledger.js';
import type {TaxTrade} from '../src/tax/ledger.js';
import {calculateGains} from '../src/tax/lots.js';
import {buildHoldings,yearEnd} from '../src/tax/holdings.js';
import {convertFx,parseEcbCsv,loadEcbRates} from '../src/tax/fx.js';
import {buildTaxExport} from '../src/tax/export.js';
import {createTaxZip} from '../src/tax/zip.js';

const databases:Database.Database[]=[];
function fixture(identity='binance:EUR'){
  const db=new Database(':memory:');databases.push(db);
  db.exec("CREATE TABLE database_identity(id INTEGER PRIMARY KEY,venue_quote TEXT NOT NULL);"+
    "CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,strategy TEXT,starting_balance REAL,cash REAL,created_at INTEGER);"+
    "CREATE TABLE trades(id TEXT PRIMARY KEY,account_id TEXT,pair TEXT,side TEXT,qty REAL,fill_price REAL,cost_eur REAL,fee_eur REAL,realized_pnl_eur REAL,ts INTEGER,reason TEXT);"+
    "CREATE TABLE candles(pair TEXT,interval INTEGER,ts INTEGER,close REAL);");
  db.prepare('INSERT INTO database_identity VALUES(1,?)').run(identity);
  return db;
}
const time=(day:string)=>Date.parse(day+'T12:00:00.000Z');
function account(db:Database.Database,cash=1000,createdAt=time('2026-01-01')){
  db.prepare("INSERT INTO accounts VALUES('a','Account A','rules',1000,?,?)").run(cash,createdAt);
}
function insert(db:Database.Database,id:string,date:string,side:'buy'|'sell',qty:number,price:number,fee=0,stored:number|null=null,pair='BTC/EUR',accountId='a'){
  db.prepare('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,accountId,pair,side,qty,price,qty*price,fee,stored,time(date),id);
}
const rates=parseEcbCsv('Date,USD,CHF\n2026-01-05,1.20,0.95\n2026-01-02,1.25,0.90\n');
afterEach(()=>{for(const db of databases.splice(0))db.close();});

describe('tax ledger and cost basis (no network)',()=>{
  it('books simulated opening capital and trades in stable chronological/id order',()=>{
    const db=fixture();account(db);insert(db,'b','2026-01-03','buy',1,10,0);insert(db,'a','2026-01-03','buy',1,10,0);
    const ledger=buildLedger(db,{from:Date.parse('2026-01-01'),to:time('2026-01-04')});
    expect(ledger.map(r=>r.id)).toEqual(['a:opening','a','b']);
    expect(ledger[0]).toMatchObject({network:'paper',exchange:'binance',quote:'EUR',reason:'Einzahlung (simuliert)'});
    expect(ledger[1]).toMatchObject({feeCurrency:'EUR',cashDelta:-10});
    expect(readIdentity(db)).toEqual({exchange:'binance',quote:'EUR',network:'paper'});
  });
  it('allocates three purchase lots for a partial sale: FIFO versus average, fees included',()=>{
    const trades:TaxTrade[]=[
      {id:'b1',accountId:'a',pair:'BTC/EUR',side:'buy',qty:1,fillPrice:10,costEur:10,feeEur:1,realizedPnlEur:null,ts:time('2026-01-01'),reason:'test'},
      {id:'b2',accountId:'a',pair:'BTC/EUR',side:'buy',qty:2,fillPrice:20,costEur:40,feeEur:0,realizedPnlEur:null,ts:time('2026-01-02'),reason:'test'},
      {id:'b3',accountId:'a',pair:'BTC/EUR',side:'buy',qty:3,fillPrice:30,costEur:90,feeEur:0,realizedPnlEur:null,ts:time('2026-01-03'),reason:'test'},
      {id:'s1',accountId:'a',pair:'BTC/EUR',side:'sell',qty:4,fillPrice:40,costEur:160,feeEur:2,realizedPnlEur:64,ts:time('2026-01-04'),reason:'test'}
    ];
    const fifo=calculateGains(trades,'fifo')[0]!,avg=calculateGains(trades,'average')[0]!;
    expect(fifo.lotsUsed).toHaveLength(3);
    expect(fifo.costBasis).toBeCloseTo(81,8);
    expect(fifo.proceeds).toBe(158);
    expect(fifo.gain).toBeCloseTo(77,8);
    expect(fifo.reconciled).toBe(false);
    expect(fifo.difference).toBeCloseTo(13,8);
    expect(avg.costBasis).toBeCloseTo(94,8);
    expect(avg.gain).toBeCloseTo(64,8);
    expect(avg.reconciled).toBe(true);
    expect(avg.holdingDays).toBeGreaterThan(0);
  });
  it('keeps old cost basis for a sale across year boundaries',()=>{
    const db=fixture();account(db,1150,time('2025-10-01'));
    insert(db,'old','2025-12-15','buy',1,100);
    insert(db,'sale','2026-01-10','sell',1,150,0,50);
    const journal=buildLedger(db,{from:Date.parse('2026-01-01'),to:yearEnd(2026)});
    expect(journal.map(r=>r.tradeId)).toEqual(['sale']);
    const gains=calculateGains([{id:'old',accountId:'a',pair:'BTC/EUR',side:'buy',qty:1,fillPrice:100,costEur:100,feeEur:0,realizedPnlEur:null,ts:time('2025-12-15'),reason:'old'},{
      id:'sale',accountId:'a',pair:'BTC/EUR',side:'sell',qty:1,fillPrice:150,costEur:150,feeEur:0,realizedPnlEur:50,ts:time('2026-01-10'),reason:'sale'}]);
    expect(gains[0]).toMatchObject({gain:50,reconciled:true});
  });
  it('rejects a mixture of paper and testnet entries',()=>{
    expect(()=>assertSingleNetwork(['paper','testnet'])).toThrow(/Netzwerk-Mischung/);
    expect(()=>assertSingleNetwork(['paper','paper'])).not.toThrow();
  });
  it('does not allow trade quote/exchange mixing in a database',()=>{
    const db=fixture('binance:EUR');account(db);insert(db,'bad','2026-01-03','buy',1,10,0,null,'BTC/USDT');
    expect(()=>buildLedger(db,{from:0,to:yearEnd(2026)})).toThrow(/Quote/);
  });
});
describe('EZB rates and holdings',()=>{
  it('uses last published rate on weekends and marks stablecoin parity',()=>{
    const chf=convertFx(rates,10,'USDT','CHF','2026-01-03');
    expect(chf.fxDate).toBe('2026-01-02');
    expect(chf.fxRate).toBeCloseTo(0.90/1.25);
    expect(chf.fxNote).toContain('USDT≈USD');
    expect(chf.fxSource).toContain('EZB');
  });
  it('fails clearly for missing historical FX, without networking',async()=>{
    expect(()=>convertFx(rates,10,'EUR','CHF','2025-12-01')).toThrow(/Kein EZB-Kurs/);
    await expect(loadEcbRates('/tmp/tax-fixture-missing-ecb-cache-20261105',false)).rejects.toThrow(/Cache fehlt/);
  });
  it('values holdings with a candle that closed before Zurich year end, plus cash',()=>{
    const db=fixture();account(db,898);
    insert(db,'b','2026-03-01','buy',1,100,2);
    const cutoff=yearEnd(2026);
    db.prepare('INSERT INTO candles VALUES(?,?,?,?)').run('BTC/EUR',15,cutoff-30*60000,120);
    db.prepare('INSERT INTO candles VALUES(?,?,?,?)').run('BTC/EUR',15,cutoff-5*60000,999);
    const {holdings,cashChecks}=buildHoldings(db,2026);
    expect(holdings.find(h=>h.asset==='BTC')).toMatchObject({price:120,value:120,cash:false});
    expect(holdings.find(h=>h.cash)).toMatchObject({qty:898,value:898});
    expect(cashChecks[0]).toMatchObject({reconciled:true});
  });
});
describe('Tax CSV / ZIP export',()=>{
  it('creates every file, BOM CSV, cash movement and correct PnL reconciliation offline',async()=>{
    const db=fixture();account(db,947);
    insert(db,'b','2026-01-02','buy',2,100,2);
    insert(db,'s','2026-01-05','sell',1,150,1,48);
    db.prepare('INSERT INTO candles VALUES(?,?,?,?)').run('BTC/EUR',15,yearEnd(2026)-30*60000,155);
    const report=await buildTaxExport(db,{year:2026,currency:'EUR',method:'average',root:'/unused',fxRates:rates,allowDownload:false});
    expect(report.files.map(f=>f.name)).toEqual(['trades.csv','realized-gains.csv','holdings-2026-12-31.csv','summary.json','LIESMICH.txt']);
    expect(report.folder).toContain('-paper');
    expect(report.files.filter(f=>f.name.endsWith('.csv')).every(f=>f.content.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])))).toBe(true);
    const text=report.files[0]!.content.toString('utf8').replace(/^\uFEFF/,'').trim().split('\r\n');
    const heads=text[0]!.split(';'),event=heads.indexOf('event'),delta=heads.indexOf('netCashDelta');
    const cashDelta=text.slice(1).filter(row=>row.split(';')[event]==='trade').reduce((s,row)=>s+Number(row.split(';')[delta]),0);
    expect(cashDelta).toBe(947-1000);
    expect(report.summary.pnlReconciliation).toMatchObject({matched:1,checked:1,mismatches:[]});
    expect(report.summary.cashReconciliation).toEqual([{account:'a',expected:947,actual:947,difference:0,reconciled:true}]);
    expect(createTaxZip(report.files,report.folder).readUInt32LE(0)).toBe(0x04034b50);
  });
});
