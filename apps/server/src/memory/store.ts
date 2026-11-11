import type Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import type {FeatureSnapshot} from '@paper/shared';
import {vector, neighbors} from './math.js';
const STEP = 900000, HOUR = 3600000;
const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
function parsedVector(raw: string): number[] | null {
  try {const v: unknown = JSON.parse(raw); return Array.isArray(v) && v.length === 8 && v.every(n => typeof n === 'number' && Number.isFinite(n)) ? v : null;} catch {return null;}
}
export function initMemoryTables(sql: Database.Database) {
  // Additive evidence only: old memory rows and outcomes are never relabelled as verified.
  sql.exec(`CREATE TABLE IF NOT EXISTS memory_observations (
    memory_id TEXT PRIMARY KEY REFERENCES memory_entries(id) ON DELETE CASCADE,
    feature_open_ts INTEGER NOT NULL, price_close_ts INTEGER NOT NULL, recorded_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_outcomes (
    memory_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
    hours INTEGER NOT NULL CHECK(hours IN (1,4,24)), available_at INTEGER NOT NULL,
    source_ts INTEGER NOT NULL, source_close REAL NOT NULL, change_pct REAL NOT NULL,
    PRIMARY KEY(memory_id,hours));`);
}
type Entry = {id: string; ts: number; pair: string; action: string; features_json: string;
  price_close_ts: number; change_pct: number; available_at: number};
export class PaperMemoryStore {
  constructor(private sql: Database.Database) {}
  save(decisionId: string, accountId: string, features: FeatureSnapshot[], actions: {pair?: string; type: string}[], observedAt: number) {
    if (!validTime(observedAt)) throw Error('Invalid memory observation time');
    this.sql.transaction(() => {for (const f of features) {
      const values = vector(f), close = f.ts + STEP;
      if (!validTime(f.ts) || f.ts % STEP !== 0 || close > observedAt || observedAt - close > 20 * 60000 || !Number.isFinite(f.price) || f.price <= 0 || !values.every(Number.isFinite)) continue;
      const id = randomUUID();
      this.sql.prepare('INSERT INTO memory_entries(id,decision_id,account_id,pair,ts,features_json,action,price_at_ts) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, decisionId, accountId, f.pair, observedAt, JSON.stringify(values), actions.find(a => a.pair === f.pair)?.type ?? 'hold', f.price);
      this.sql.prepare('INSERT INTO memory_observations VALUES(?,?,?,?)').run(id, f.ts, close, observedAt);
    }})();
  }
  backfill(asOf: number) {
    if (!validTime(asOf)) throw Error('Invalid memory outcome time');
    let recorded = 0;
    this.sql.transaction(() => {for (const hours of [1,4,24] as const) {
      const rows = this.sql.prepare(`SELECT m.id,m.price_at_ts,o.price_close_ts,c.ts,c.open,c.high,c.low,c.close,c.volume
        FROM memory_entries m JOIN memory_observations o ON o.memory_id=m.id
        JOIN candles c ON c.pair=m.pair AND c.interval=15 AND c.ts=o.price_close_ts+?-?
        WHERE o.recorded_at<=? AND o.price_close_ts+?<=?
          AND NOT EXISTS(SELECT 1 FROM memory_outcomes x WHERE x.memory_id=m.id AND x.hours=?)
        ORDER BY o.recorded_at,m.id LIMIT 400`).all(hours*HOUR,STEP,asOf,hours*HOUR,asOf,hours) as
        {id:string;price_at_ts:number;price_close_ts:number;ts:number;open:number;high:number;low:number;close:number;volume:number}[];
      for (const r of rows) {
        if (![r.open,r.high,r.low,r.close,r.volume,r.price_at_ts].every(Number.isFinite) || r.low<=0 || r.high<Math.max(r.open,r.close) || r.low>Math.min(r.open,r.close) || r.volume<0 || r.price_at_ts<=0) continue;
        const change=(r.close/r.price_at_ts-1)*100;
        if (!Number.isFinite(change)) continue;
        this.sql.prepare('INSERT INTO memory_outcomes VALUES(?,?,?,?,?,?)').run(r.id,hours,asOf,r.ts,r.close,change);
        const column=hours===1?'change_1h':hours===4?'change_4h':'change_24h';
        // Preserve existing legacy values. Recall uses the independently recorded sidecar only.
        this.sql.prepare(`UPDATE memory_entries SET ${column}=? WHERE id=? AND ${column} IS NULL`).run(change,r.id);
        recorded++;
      }
    }})();
    return recorded;
  }
  recall(pair: string, f: FeatureSnapshot, asOf: number, accountId?: string) {
    if (!validTime(asOf)) throw Error('Explicit valid memory asOf required');
    const target=vector(f);
    const result = {pair, hits: [] as {ts:number;pair:string;action:string;change1h:number|null;change4h:number;change24h:number|null;tradePnlEur:null;distance:number;priceCloseTs:number;outcomeAvailableAt:number}[],
      summary: '', evidence: {version:'paper-memory-v2',asOf,accountId:accountId??null,legacyRowsExcluded:0,invalidVectorsExcluded:0,duplicateWindowsExcluded:0,overlapWindowsExcluded:0,normalizationRows:0,independence:'unknown',performanceValidated:false,estimatedWinProbability:null,scope:'observed closed-price changes, not executed trade PnL; costs not deducted'}};
    result.evidence.legacyRowsExcluded=(this.sql.prepare(`SELECT count(*) n FROM memory_entries m
      WHERE m.pair=? AND m.ts<=? ${accountId===undefined?'':'AND m.account_id=?'}
      AND NOT EXISTS(SELECT 1 FROM memory_observations o WHERE o.memory_id=m.id)`)
      .get(...(accountId===undefined?[pair,asOf]:[pair,asOf,accountId])) as {n:number}).n;
    if (!target.every(Number.isFinite) || !validTime(f.ts) || f.ts+STEP>asOf) {result.summary='Keine zeitlich gueltige Zielbeobachtung';return result;}
    const rows=this.sql.prepare(`SELECT m.id,m.ts,m.pair,m.action,m.features_json,o.price_close_ts,x.change_pct,x.available_at
      FROM memory_entries m JOIN memory_observations o ON o.memory_id=m.id
      JOIN memory_outcomes x ON x.memory_id=m.id AND x.hours=4
      WHERE m.pair=? AND m.ts<=? AND o.recorded_at<=? AND x.available_at<=? AND o.price_close_ts+?<=?
      ${accountId===undefined?'':'AND m.account_id=?'}
      ORDER BY m.ts DESC,m.id LIMIT 2000`).all(...(accountId===undefined?[pair,asOf,asOf,asOf,4*HOUR,asOf]:[pair,asOf,asOf,asOf,4*HOUR,asOf,accountId])) as Entry[];
    const byId=new Map<string,Entry>(), byClose=new Set<number>(), candidates:{id:string;vector:number[]}[]=[];
    // Stable earliest stored observation per price window; account duplicates do not multiply samples.
    for (const r of [...rows].sort((a,b)=>a.ts-b.ts||a.id.localeCompare(b.id))) {
      const v=parsedVector(r.features_json);
      if (!v || !Number.isFinite(r.change_pct)) {result.evidence.invalidVectorsExcluded++;continue;}
      if (byClose.has(r.price_close_ts)) {result.evidence.duplicateWindowsExcluded++;continue;}
      byClose.add(r.price_close_ts);byId.set(r.id,r);candidates.push({id:r.id,vector:v});
    }
    result.evidence.normalizationRows=candidates.length;
    // All scaling inputs have mature, available 4h outcomes at the same historical asOf.
    for (const n of neighbors(target,candidates,candidates.length)) {
      const r=byId.get(n.id)!;
      if (result.hits.some(h=>Math.abs(h.priceCloseTs-r.price_close_ts)<4*HOUR)) {result.evidence.overlapWindowsExcluded++;continue;}
      const extra=this.sql.prepare(`SELECT hours,change_pct FROM memory_outcomes WHERE memory_id=? AND available_at<=?
        AND ?+hours*?<=?`).all(r.id,asOf,r.price_close_ts,HOUR,asOf) as {hours:number;change_pct:number}[];
      const outcome=(h:number)=>{const v=extra.find(x=>x.hours===h)?.change_pct;return typeof v==='number'&&Number.isFinite(v)?v:null;};
      result.hits.push({ts:r.ts,pair:r.pair,action:r.action,change1h:outcome(1),change4h:r.change_pct,change24h:outcome(24),tradePnlEur:null,distance:n.distance,priceCloseTs:r.price_close_ts,outcomeAvailableAt:r.available_at});
      if (result.hits.length===5) break;
    }
    result.summary=result.hits.length ? `${result.hits.length} nicht ueberlappende historische4h-Preisfenster; ${result.hits.filter(h=>h.change4h>0).length} positiv. Keine unabhaengigen Versuche oder Gewinnwahrscheinlichkeit; Kosten/Trade-PnL nicht ausgewertet.` : 'Keine verifizierten, damals verfuegbaren4h-Preisfenster; alte Erinnerungen bleiben unbestaetigt.';
    return result;
  }
}
