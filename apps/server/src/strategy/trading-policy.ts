import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import {z} from 'zod';
export const TradingSettingsSchema=z.object({mode:z.enum(['safe','risky']),stopLossPct:z.number().min(.02).max(.15),expectedRevision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1)}).strict();
export const PROFILES={
 safe:{label:'Safe Trade',maxPositionPct:.15,maxOpenPositions:2,maxEntriesPerDay:4,minEntryMinutes:120,cooldownMinutes:120,maxPortfolioRiskPct:.0125,maxSpreadBps:10,maxSlippageBps:15,minConfidence:.80},
 risky:{label:'Risky',maxPositionPct:.30,maxOpenPositions:4,maxEntriesPerDay:10,minEntryMinutes:30,cooldownMinutes:60,maxPortfolioRiskPct:.025,maxSpreadBps:20,maxSlippageBps:30,minConfidence:.60}
} as const;
export type TradingMode=keyof typeof PROFILES;
export type TradingSettings={mode:TradingMode;stopLossPct:number;revision:number;updatedAt:number|null};
export type HardLimits={MAX_POSITION_PCT:number;MAX_OPEN_POSITIONS:number;MAX_TRADES_PER_DAY:number;COIN_COOLDOWN_MINUTES:number;MAX_TOTAL_RISK_PCT:number;MAX_ENTRY_SPREAD_BPS:number;MAX_ENTRY_SLIPPAGE_BPS:number;DEFAULT_STOP_LOSS_PCT:number};
export function effectiveTradingPolicy(settings:TradingSettings,hard:HardLimits){
 const p=PROFILES[settings.mode],policy={version:1,...settings,label:p.label,maxPositionPct:Math.min(p.maxPositionPct,hard.MAX_POSITION_PCT),maxOpenPositions:Math.min(p.maxOpenPositions,hard.MAX_OPEN_POSITIONS),maxEntriesPerDay:Math.min(p.maxEntriesPerDay,hard.MAX_TRADES_PER_DAY),minEntryMinutes:p.minEntryMinutes,cooldownMinutes:Math.max(p.cooldownMinutes,hard.COIN_COOLDOWN_MINUTES),maxPortfolioRiskPct:Math.min(p.maxPortfolioRiskPct,hard.MAX_TOTAL_RISK_PCT),maxSpreadBps:Math.min(p.maxSpreadBps,hard.MAX_ENTRY_SPREAD_BPS),maxSlippageBps:Math.min(p.maxSlippageBps,hard.MAX_ENTRY_SLIPPAGE_BPS),minConfidence:p.minConfidence,stopBasis:'average entry including buy fees',scope:'AI risk preferences shared with native new entries; additional native guards apply. Existing stops never loosen; exits are exempt from entry frequency gates',confidenceMeaning:'Uncalibrated model filter, never a probability or sizing input'};
 return {...policy,fingerprint:createHash('sha256').update(JSON.stringify(policy)).digest('hex')};
}
export type TradingPolicy=ReturnType<typeof effectiveTradingPolicy>;
export function entryPolicyGuard(policy:TradingPolicy,input:{revision?:number;confidence?:number;lastEntryAt?:number;now:number}){
 if(input.revision!==policy.revision)return 'Trading-Modus wurde geändert; neue Entscheidung erforderlich';
 if(typeof input.confidence!=='number'||!Number.isFinite(input.confidence)||input.confidence<policy.minConfidence||input.confidence>1)return 'Konfidenzfilter des Trading-Modus nicht erfüllt (keine Gewinnwahrscheinlichkeit)';
 if(input.lastEntryAt!==undefined&&(input.lastEntryAt>input.now||input.now-input.lastEntryAt<policy.minEntryMinutes*60000))return 'Kaufpause des Trading-Modus aktiv';
 return null;
}
export class TradingPolicyConflict extends Error{}
export function initTradingPolicies(db:Database.Database){db.exec(`
 CREATE TABLE IF NOT EXISTS account_trading_settings(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,mode TEXT NOT NULL CHECK(mode IN ('safe','risky')),stop_loss_pct REAL NOT NULL CHECK(stop_loss_pct BETWEEN .02 AND .15),revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS trading_policy_changes(account_id TEXT NOT NULL,revision INTEGER NOT NULL,policy_json TEXT NOT NULL,tightened_positions_json TEXT NOT NULL,recorded_at INTEGER NOT NULL,PRIMARY KEY(account_id,revision));
 CREATE TABLE IF NOT EXISTS paper_trade_policy(trade_id TEXT PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,policy_json TEXT NOT NULL,recorded_at INTEGER NOT NULL);
 `);}
export class TradingPolicyStore{
 constructor(private db:Database.Database,private hard:HardLimits){}
 get(id:string):TradingPolicy|null{
  const account=this.db.prepare('SELECT strategy FROM accounts WHERE id=?').get(id) as {strategy:string}|undefined;if(account?.strategy!=='ai')return null;
  const row=this.db.prepare('SELECT mode,stop_loss_pct,revision,updated_at FROM account_trading_settings WHERE account_id=?').get(id) as {mode:TradingMode;stop_loss_pct:number;revision:number;updated_at:number}|undefined;
  if(row&&!TradingSettingsSchema.safeParse({mode:row.mode,stopLossPct:row.stop_loss_pct,expectedRevision:row.revision}).success)throw Error('Invalid persisted trading policy');
  return effectiveTradingPolicy(row?{mode:row.mode,stopLossPct:row.stop_loss_pct,revision:row.revision,updatedAt:row.updated_at}:{mode:'safe',stopLossPct:this.hard.DEFAULT_STOP_LOSS_PCT,revision:0,updatedAt:null},this.hard);
 }
 save(id:string,value:unknown,now=Date.now()){
  const request=TradingSettingsSchema.parse(value);
  return this.db.transaction(()=>{
   const old=this.get(id);if(!old)throw Error('Trading-Modi sind nur für das KI-Paper-Konto verfügbar');
   if(request.expectedRevision!==old.revision)throw new TradingPolicyConflict('Einstellungen inzwischen geändert; bitte neu laden');
   if(request.mode===old.mode&&request.stopLossPct===old.stopLossPct)return {policy:old,tightenedPositions:[] as string[]};
   const policy=effectiveTradingPolicy({mode:request.mode,stopLossPct:request.stopLossPct,revision:old.revision+1,updatedAt:now},this.hard);
   this.db.prepare('INSERT INTO account_trading_settings VALUES (?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET mode=excluded.mode,stop_loss_pct=excluded.stop_loss_pct,revision=excluded.revision,updated_at=excluded.updated_at').run(id,policy.mode,policy.stopLossPct,policy.revision,now);
   const held=this.db.prepare('SELECT id,avg_entry_price,stop_loss_price FROM positions WHERE account_id=?').all(id) as {id:string;avg_entry_price:number;stop_loss_price:number|null}[];
   const tightenedPositions:string[]=[];
   for(const p of held){const stop=p.avg_entry_price*(1-policy.stopLossPct);if(!Number.isFinite(stop)||stop<=0)throw Error('Ungültiger Einstand; Änderung nicht gespeichert');if(p.stop_loss_price===null||!Number.isFinite(p.stop_loss_price)||p.stop_loss_price<stop){this.db.prepare('UPDATE positions SET stop_loss_price=? WHERE id=? AND account_id=?').run(stop,p.id,id);tightenedPositions.push(p.id);}}
   this.db.prepare('INSERT INTO trading_policy_changes VALUES (?,?,?,?,?)').run(id,policy.revision,JSON.stringify(policy),JSON.stringify(tightenedPositions),now);
   return {policy,tightenedPositions};
  })();
 }
}
