import {initPaperDcaLedger} from './dca/paper.js';
import {initPositionEntries} from './context/position-entry.js';
import {initMemoryTables} from './memory/store.js';
import {initTradingPolicies} from './strategy/trading-policy.js';
import {initExitFailures} from './strategy/protectiveExits.js';
import {initForward} from './research/forward.js';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {eq,and} from 'drizzle-orm';
import {dirname,resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {config,projectRoot} from './config.js';
import * as tables from './schema.js';
const file=resolve(projectRoot,config.DATABASE_PATH);mkdirSync(dirname(file),{recursive:true});
export const sqlite:Database.Database=new Database(file);
sqlite.pragma('journal_mode = WAL');sqlite.pragma('foreign_keys = ON');
// Schema is maintained with drizzle-table declarations; the bundled bootstrap SQL is
// deterministic for freshly created databases. drizzle-kit generates subsequent migrations.
const definitions:Record<string,string>={
 pairs:'symbol TEXT PRIMARY KEY,rest_name TEXT NOT NULL,base TEXT NOT NULL,quote TEXT NOT NULL,ordermin REAL NOT NULL,costmin REAL NOT NULL,lot_decimals INTEGER NOT NULL,pair_decimals INTEGER NOT NULL,active INTEGER NOT NULL,volume_24h_eur REAL NOT NULL,status TEXT NOT NULL DEFAULT "online",updated_at INTEGER NOT NULL',
 candles:'pair TEXT NOT NULL,interval INTEGER NOT NULL,ts INTEGER NOT NULL,open REAL NOT NULL,high REAL NOT NULL,low REAL NOT NULL,close REAL NOT NULL,volume REAL NOT NULL,PRIMARY KEY(pair,interval,ts)',
 accounts:'id TEXT PRIMARY KEY,name TEXT NOT NULL,strategy TEXT NOT NULL,starting_balance REAL NOT NULL,cash REAL NOT NULL,peak_equity REAL NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL',
 positions:'id TEXT PRIMARY KEY,account_id TEXT NOT NULL,pair TEXT NOT NULL,qty REAL NOT NULL,avg_entry_price REAL NOT NULL,cost_basis_eur REAL NOT NULL,stop_loss_price REAL,take_profit_price REAL,opened_at INTEGER NOT NULL',
 trades:'id TEXT PRIMARY KEY,account_id TEXT NOT NULL,pair TEXT NOT NULL,side TEXT NOT NULL,qty REAL NOT NULL,fill_price REAL NOT NULL,cost_eur REAL NOT NULL,fee_eur REAL NOT NULL,mid_price_at_decision REAL NOT NULL,slippage_bps REAL NOT NULL,latency_ms INTEGER NOT NULL,reason TEXT NOT NULL,decision_id TEXT NOT NULL,realized_pnl_eur REAL,ts INTEGER NOT NULL',
 trade_provenance:'trade_id TEXT PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,run_id TEXT NOT NULL,build_id TEXT,strategy_version TEXT NOT NULL,universe_hash TEXT NOT NULL,evaluation_version TEXT NOT NULL,verified INTEGER NOT NULL,recorded_at INTEGER NOT NULL',
 rejected_orders:'id TEXT PRIMARY KEY,account_id TEXT NOT NULL,pair TEXT NOT NULL,side TEXT NOT NULL,requested TEXT NOT NULL,reason TEXT NOT NULL,decision_id TEXT NOT NULL,ts INTEGER NOT NULL',
 decisions:'id TEXT PRIMARY KEY,account_id TEXT NOT NULL,provider TEXT NOT NULL,ts INTEGER NOT NULL,status TEXT NOT NULL,market_view TEXT,actions_json TEXT,context_json TEXT,prompt_text TEXT,raw_response TEXT',
 decision_evidence:'decision_id TEXT PRIMARY KEY REFERENCES decisions(id) ON DELETE CASCADE,evidence_json TEXT NOT NULL,recorded_at INTEGER NOT NULL',
 memory_entries:'id TEXT PRIMARY KEY,decision_id TEXT NOT NULL,account_id TEXT NOT NULL,pair TEXT NOT NULL,ts INTEGER NOT NULL,features_json TEXT NOT NULL,action TEXT NOT NULL,price_at_ts REAL NOT NULL,change_1h REAL,change_4h REAL,change_24h REAL,trade_pnl_eur REAL',
 lessons:'id TEXT PRIMARY KEY,text TEXT NOT NULL,source TEXT NOT NULL,active INTEGER NOT NULL,created_at INTEGER NOT NULL',
 equity_snapshots:'account_id TEXT NOT NULL,ts INTEGER NOT NULL,equity REAL NOT NULL,cash REAL NOT NULL,PRIMARY KEY(account_id,ts)'
};
for(const [name,columns] of Object.entries(definitions))sqlite.exec(`CREATE TABLE IF NOT EXISTS ${name} (${columns})`);
initMemoryTables(sqlite);
initForward(sqlite);
initExitFailures(sqlite);
initTradingPolicies(sqlite);
initPositionEntries(sqlite);
initPaperDcaLedger(sqlite);
sqlite.exec('CREATE INDEX IF NOT EXISTS ix_candles_ts ON candles(pair,interval,ts);CREATE INDEX IF NOT EXISTS ix_trades_account_ts ON trades(account_id,ts);CREATE INDEX IF NOT EXISTS ix_memory_pair_ts ON memory_entries(pair,ts);');
const identity=`${config.EXCHANGE}:${config.QUOTE_CURRENCY}`;
sqlite.exec('CREATE TABLE IF NOT EXISTS database_identity (id INTEGER PRIMARY KEY CHECK(id=1), venue_quote TEXT NOT NULL)');
const previousIdentity=sqlite.prepare('SELECT venue_quote FROM database_identity WHERE id=1').get() as {venue_quote:string}|undefined;
if(previousIdentity&&previousIdentity.venue_quote!==identity)throw Error('Datenbank gehört zu einer anderen Börse/Währung; separate DATABASE_PATH verwenden');
if(!previousIdentity){const used=(sqlite.prepare('SELECT count(*) AS n FROM accounts').get() as {n:number}).n;if(used&&identity!=='kraken:EUR')throw Error('Bestehende nicht markierte Datenbank ist Kraken/EUR; neue DATABASE_PATH verwenden');sqlite.prepare('INSERT INTO database_identity VALUES (1,?)').run(identity);}
export const db=drizzle(sqlite,{schema:tables});
export function initAccounts(){const now=Date.now();for(const [id,name,strategy] of [['ai','KI','ai'],['rules','Regeln','rules'],['hold','Buy & Hold','hold'],['dca','DCA Sparplan','dca']]){
 db.insert(tables.accounts).values({id:id!,name:name!,strategy:strategy!,startingBalance:strategy==='dca'?0:config.STARTING_BALANCE_EUR,cash:strategy==='dca'?0:config.STARTING_BALANCE_EUR,peakEquity:strategy==='dca'?0:config.STARTING_BALANCE_EUR,status:strategy==='ai'&&!(config.AI_PROVIDER==='mock'||config.AI_ENABLED&&config.AI_PROVIDER==='openai-compatible')?'inactive':'active',createdAt:now}).onConflictDoNothing().run();
 } if(config.AI_PROVIDER==='mock'||config.AI_ENABLED&&config.AI_PROVIDER==='openai-compatible') db.update(tables.accounts).set({status:'active'}).where(and(eq(tables.accounts.id,'ai'),eq(tables.accounts.status,'inactive'))).run();
 else db.update(tables.accounts).set({status:'inactive'}).where(eq(tables.accounts.id,'ai')).run();}
