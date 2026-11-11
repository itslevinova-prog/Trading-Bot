import type Database from 'better-sqlite3';

export type PaperDcaVariant = 'classic' | 'trend-park' | 'trend-double' | 'value-average';
export type PaperDcaSettings = {
  amount: number;
  interval: 'weekly' | 'monthly';
  allocation: {btc:number;eth:number};
  variant: PaperDcaVariant;
};
export function loadPaperDcaSettings(env:NodeJS.ProcessEnv=process.env):PaperDcaSettings {
 const amount=Number(env.DCA_AMOUNT??'100');
 const interval=env.DCA_INTERVAL??'monthly';
 const variant=env.DCA_VARIANT??'classic';
 const fractions=(env.DCA_ALLOCATION??'70/30').split('/').map(Number);
 if(!Number.isFinite(amount)||amount<=0||amount>1_000_000||
  (interval!=='weekly'&&interval!=='monthly')||
  !['classic','trend-park','trend-double','value-average'].includes(variant)||
  fractions.length!==2||fractions.some(n=>!Number.isFinite(n)||n<0)||
  Math.abs(fractions[0]!+fractions[1]!-100)>1e-9)
   throw Error('Invalid DCA paper configuration; no deposit or trade');
 return {amount,interval,variant:variant as PaperDcaVariant,
  allocation:{btc:fractions[0]!/100,eth:fractions[1]!/100}};
}
/** UTC calendar periods, not local DST-sensitive scheduler timestamps. */
export function dcaPeriod(now:number,interval:'weekly'|'monthly') {
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid DCA date');
 const d=new Date(now);
 const monday=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-
   ((d.getUTCDay()+6)%7)*86_400_000;
 return interval==='weekly'?new Date(monday).toISOString().slice(0,10):
  d.toISOString().slice(0,7);
}
export function initPaperDcaLedger(sqlite:Database.Database) {
 sqlite.exec(`CREATE TABLE IF NOT EXISTS dca_paper_deposits (
 account_id TEXT NOT NULL, period TEXT NOT NULL, ts INTEGER NOT NULL,
 amount REAL NOT NULL CHECK(amount>0), PRIMARY KEY(account_id,period));
 CREATE TABLE IF NOT EXISTS dca_paper_decisions (
 account_id TEXT NOT NULL, period TEXT NOT NULL, ts INTEGER NOT NULL,
 variant TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL,
 PRIMARY KEY(account_id,period));`);
}
/** Deposit simulated cash once; accounts are created with zero starting balance. */
export function depositPaperCash(sqlite:Database.Database,accountId:string,period:string,amount:number,now:number) {
 if(accountId!=='dca'||!/^\d{4}-\d{2}(-\d{2})?$/.test(period)||
  !Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(now))throw Error('Invalid paper deposit');
 return sqlite.transaction(()=>{
  const account=sqlite.prepare('SELECT strategy,status FROM accounts WHERE id=?').get(accountId) as {strategy:string;status:string}|undefined;
  if(account?.strategy!=='dca'||account.status!=='active')throw Error('DCA paper account not active');
  const result=sqlite.prepare('INSERT OR IGNORE INTO dca_paper_deposits(account_id,period,ts,amount) VALUES(?,?,?,?)')
   .run(accountId,period,now,amount);
  if(result.changes===1) {
   const changed=sqlite.prepare('UPDATE accounts SET cash=cash+? WHERE id=? AND strategy=?').run(amount,accountId,'dca');
   if(changed.changes!==1)throw Error('DCA deposit account vanished');
  }
  return result.changes===1;
 })();
}
/** One-shot decision reservation prevents duplicate orders after a restart. */
export function reservePaperDcaDecision(sqlite:Database.Database,period:string,variant:PaperDcaVariant,now:number) {
 const found=sqlite.prepare('INSERT OR IGNORE INTO dca_paper_decisions(account_id,period,ts,variant,status,reason) VALUES(?,?,?,?,?,?)')
  .run('dca',period,now,variant,'reserved','Started; no fill is claimed until broker confirms');
 return found.changes===1;
}
export function finalisePaperDcaDecision(sqlite:Database.Database,period:string,status:string,reason:string) {
 if(!['filled','partial','not-filled','parked','history-missing'].includes(status)||reason.length>1000)
  throw Error('Invalid paper DCA decision');
 sqlite.prepare('UPDATE dca_paper_decisions SET status=?,reason=? WHERE account_id=? AND period=?')
  .run(status,reason,'dca',period);
}
/** Use 200 prior fully closed daily candles for paper variants; no look-ahead. */
export function paperSma200(sqlite:Database.Database,basePair:string,now:number):{previousClose:number;sma:number}|null {
 const day=86_400_000,today=Math.floor(now/day)*day;
 // Prefer explicit 1d candles when present; never interpolate gaps.
 let rows=sqlite.prepare('SELECT ts,close FROM candles WHERE pair=? AND interval=1440 AND ts<? ORDER BY ts DESC LIMIT 200')
  .all(basePair,today) as {ts:number;close:number}[];
 // The production paper DB stores 60-minute candles; derive daily closes only
 // when all 24 hourly bars exist. No gap filling or current-day candles.
 if(rows.length!==200){
  const hourly=sqlite.prepare('SELECT ts,close FROM candles WHERE pair=? AND interval=60 AND ts>=? AND ts<? ORDER BY ts')
   .all(basePair,today-200*day,today) as {ts:number;close:number}[];
  if(hourly.length!==200*24)return null;
  for(let i=0;i<hourly.length;i++)if(hourly[i]!.ts!==today-200*day+i*3_600_000||
    !Number.isFinite(hourly[i]!.close)||hourly[i]!.close<=0)return null;
  rows=Array.from({length:200},(_,i)=>({ts:today-(i+1)*day,close:hourly[(199-i)*24+23]!.close}));
 }
 for(let i=0;i<rows.length;i++)if(rows[i]!.ts!==today-(i+1)*day||
   !Number.isFinite(rows[i]!.close)||rows[i]!.close<=0)return null;
 return {previousClose:rows[0]!.close,sma:rows.reduce((s,x)=>s+x.close,0)/200};
}
export function paperDcaBudget(settings:PaperDcaSettings,deposited:number,cash:number,trend:boolean|null):number|null {
 if(!Number.isFinite(cash)||cash<0)return null;
 if(settings.variant!=='classic'&&trend===null)return null;
 const amount=settings.variant==='classic'?deposited:
  settings.variant==='trend-park'?(trend?cash:0):
  settings.variant==='trend-double'?(trend?deposited:2*deposited):
  deposited*(trend?0.5:1.5);
 return Math.min(cash,Math.max(0,amount));
}
