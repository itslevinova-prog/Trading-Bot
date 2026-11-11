import {DEFAULT_RISK_LIMITS,inspectPortfolioRisk} from '../risk-engine/engine.js';
import {paperRiskSnapshot} from '../risk-engine/paper.js';
import {buildTaxExport} from '../tax/export.js';
import {createTaxZip} from '../tax/zip.js';
import {TradingSettingsSchema,TradingPolicyConflict,effectiveTradingPolicy} from '../strategy/trading-policy.js';
import {readForwardCohort} from '../research/cohort.js';
import {SqliteExitFailures} from '../strategy/protectiveExits.js';
import {forwardSummary} from '../research/forward.js';
import {externalContext} from '../context/external.js';
import {portfolioEvidence} from '../context/portfolio-evidence.js';
import {randomUUID} from 'node:crypto';import type {FastifyInstance} from 'fastify';import {z} from 'zod';import {eq,desc,and,gte,lte,sql} from 'drizzle-orm';
import {collectMarketContext} from '../context/collector.js';
import {db,sqlite} from '../db.js';import {accounts,pairs,candles,positions,trades,decisions,lessons,equitySnapshots,memoryEntries,rejectedOrders,tradeProvenance} from '../schema.js';
import {config,publicConfig,projectRoot} from '../config.js';import {runResearch} from '../research/backtest.js';import {analyzeRobustness} from '../research/robustness.js';import {assessSignalQuality} from '../strategy/quality.js';import {computeAccountAnalytics} from '../research/analytics.js';import type {MarketFeed} from '../market/types.js';import type {PaperExecutionAdapter} from '../broker/PaperExecutionAdapter.js';
export function registerRoutes(app:FastifyInstance,market:MarketFeed,broker:PaperExecutionAdapter,onProtectionChange?:(pairs:string[])=>void){
 app.get('/api/export/tax',async(req,reply)=>{
  const parsed=z.object({
    year:z.coerce.number().int().min(2000).max(2100),
    currency:z.enum(['CHF','EUR']).default('CHF'),
    method:z.enum(['fifo','average']).default('fifo'),
    account:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
    delimiter:z.enum([';',',','\t']).default(';')
  }).safeParse(req.query);
  if(!parsed.success)return reply.code(400).send({error:'Ungültige Steuer-Export-Parameter'});
  const q=parsed.data;
  try{
    const report=await buildTaxExport(sqlite,{year:q.year,currency:q.currency,method:q.method,
      accountId:q.account,delimiter:q.delimiter,root:projectRoot});
    return reply.type('application/zip')
      .header('Content-Disposition','attachment; filename="'+report.folder+'.zip"')
      .header('Cache-Control','no-store')
      .send(createTaxZip(report.files,report.folder));
  }catch(e){return reply.code(422).send({error:e instanceof Error?e.message:'Steuer-Export fehlgeschlagen'});}
 });

 app.get('/api/accounts/:id/trading-policy',(req,reply)=>{const {id}=req.params as {id:string};const policy=broker.policies.get(id);return policy?{policy,profiles:(['safe','risky'] as const).map(mode=>effectiveTradingPolicy({mode,stopLossPct:policy.stopLossPct,revision:policy.revision,updatedAt:policy.updatedAt},config))}:reply.code(404).send({error:'Kein KI-Paper-Konto'});});
 app.put('/api/accounts/:id/trading-policy',(req,reply)=>{
  const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host)return reply.code(403).send({error:'Fremde Origin nicht erlaubt'});}catch{return reply.code(403).send({error:'Ungültige Origin'});}}
  const parsed=TradingSettingsSchema.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Ungültiger Modus, Stop (2–15 %) oder Revisionsstand'});
  const {id}=req.params as {id:string};if(!broker.policies.get(id))return reply.code(404).send({error:'Kein KI-Paper-Konto'});
  try{const result=broker.policies.save(id,parsed.data);onProtectionChange?.(db.select().from(positions).where(eq(positions.accountId,id)).all().map(p=>p.pair));return {...result,paperOnly:true};}catch(error){if(error instanceof TradingPolicyConflict)return reply.code(409).send({error:error.message});throw error;}
 });
 app.get('/api/trades/:id/policy',req=>{const {id}=req.params as {id:string};const row=sqlite.prepare('SELECT policy_json FROM paper_trade_policy WHERE trade_id=?').get(id) as {policy_json:string}|undefined;return row?{available:true,policy:JSON.parse(row.policy_json)}:{available:false};});
 app.get('/api/status',()=>({connected:market.connected,exchange:market.venue,quoteCurrency:config.QUOTE_CURRENCY,version:'0.4.0',paperOnly:true,config:publicConfig,serverTime:Date.now(),bookAges:db.select().from(pairs).where(eq(pairs.active,true)).all().map(p=>({symbol:p.symbol,ageMs:market.books.get(p.symbol)?Date.now()-market.books.get(p.symbol)!.receivedAt:null}))}));
 app.get('/api/protective-exits',()=>new SqliteExitFailures(sqlite).all());
 app.get('/api/forward-cohort',()=>readForwardCohort(sqlite,broker.executionProvenance().buildVerified?broker.executionProvenance().evaluationVersion:null));
 app.get('/api/forward-evidence',()=>db.select().from(accounts).all().map(a=>forwardSummary(sqlite,a.id,broker.executionProvenance(a.id).buildVerified?broker.executionProvenance(a.id).evaluationVersion:null)));
 app.get('/api/portfolio-replay',()=>portfolioEvidence(market.venue,config.QUOTE_CURRENCY,false,broker.provenance?.strategyVersion,broker.executionProvenance().universeHash??undefined));
 app.get('/api/rule-funnel',()=>{const source=portfolioEvidence(market.venue,config.QUOTE_CURRENCY,false,broker.provenance?.strategyVersion,broker.executionProvenance().universeHash??undefined) as {ruleFunnel?:unknown};return source.ruleFunnel??{status:'unavailable',profitabilityEstablished:false,reason:'No validated local rule diagnostic'};});
 app.get('/api/external-context',()=>externalContext.snapshot());
 app.get('/api/provenance',()=>{const total=db.select({n:sql<number>`count(*)`}).from(trades).get()?.n??0,tagged=db.select({n:sql<number>`count(*)`}).from(tradeProvenance).get()?.n??0;return {...(broker.provenance??{verified:false,reason:'No runtime identity attached'}),execution:broker.executionProvenance(),coverage:{totalTrades:total,taggedTrades:tagged,unattributedTrades:total-tagged}};});
 app.get('/api/trades/:id/provenance',req=>{const {id}=req.params as {id:string};return db.select().from(tradeProvenance).where(eq(tradeProvenance.tradeId,id)).get()??{verified:false,reason:'No original execution provenance recorded'};});
 app.get('/api/context',()=>collectMarketContext(market));
 app.get('/api/readiness',()=>{const context=collectMarketContext(market);const last=db.select().from(decisions).where(eq(decisions.accountId,'ai')).orderBy(desc(decisions.ts)).limit(1).get();return {checkedAt:Date.now(),executionMode:'paper',venue:market.venue,quoteCurrency:config.QUOTE_CURRENCY,freeDefaults:!config.AI_ALLOW_REMOTE,ai:{modelMode:config.AI_MODEL_MODE,fingerprintConfigured:!!config.AI_EXPECTED_MODEL_FINGERPRINT,contextTokens:config.AI_CONTEXT_TOKENS,modelArtifactVerified:false,provider:config.AI_PROVIDER,enabled:config.AI_ENABLED,remoteAllowed:config.AI_ALLOW_REMOTE,lastDecisionStatus:last?.status??null,lastContextAt:last?.ts??null},gates:[{label:'Alle Paper-Bestände frisch bewertet',passed:db.select().from(accounts).all().every(a=>broker.valuation(a.id).complete)},{label:'Keine offenen Paper-Schutzverkäufe',passed:new SqliteExitFailures(sqlite).all().length===0},{label:'Ausgeführter Build gegen aufgezeichnete Dateien geprüft',passed:broker.provenance?.verified===true},{label:'Öffentliche Börsenverbindung',passed:market.connected},{label:'Frische Orderbücher für alle beobachteten Märkte',passed:context.markets.length>0&&context.markets.every(m=>m.quality.bookUsable)},{label:'Rund 90 Tage geschlossene Historie je Markt',passed:context.markets.length>0&&context.markets.every(m=>m.quality.closedBars>=8500&&m.quality.firstAt!==null&&Date.now()-m.quality.firstAt>=89*86400000)},{label:'Unabhängige langfristige Forward-Performance nach Kosten',passed:false},{label:'Private Testnet-Fills und Schutzorders am Zielkonto geprüft',passed:false}],liveAvailableViaSeparateProcess:true,liveEnabledInDashboard:false,profitabilityEstablished:false,message:'Technische Bereitschaft ist keine Gewinnwahrscheinlichkeit. Nicht geprüfte Live-/Performance-Nachweise bleiben gesperrt bzw. unbekannt.'};});
 app.get('/api/signal-quality',()=>[...market.features.values()].map(f=>({pair:f.pair,ts:f.ts,assessment:assessSignalQuality(f,config.TAKER_FEE_RATE)})));
 app.get('/api/pairs',()=>db.select().from(pairs).where(eq(pairs.active,true)).all().map(p=>({...p,ticker:market.tickers.get(p.symbol),feature:market.features.get(p.symbol),book:market.books.get(p.symbol)?{bids:market.books.get(p.symbol)!.bids.slice(0,5),asks:market.books.get(p.symbol)!.asks.slice(0,5)}:null,bookFresh:!!market.books.get(p.symbol)?.valid&&Date.now()-market.books.get(p.symbol)!.receivedAt<=config.MAX_BOOK_AGE_MS})));
 app.get('/api/candles',(req,reply)=>{const parsed=z.object({pair:z.string(),interval:z.coerce.number().refine(x=>[15,60].includes(x)),from:z.coerce.number().optional(),to:z.coerce.number().optional()}).safeParse(req.query);if(!parsed.success)return reply.code(400).send({error:'Ungültige Anfrage'});const q=parsed.data;return db.select().from(candles).where(and(eq(candles.pair,q.pair),eq(candles.interval,q.interval),gte(candles.ts,q.from??0),lte(candles.ts,q.to??Date.now()))).orderBy(candles.ts).limit(3000).all();});
 app.get('/api/dca',()=>({
  paperOnly:true,config:{interval:process.env.DCA_INTERVAL??'monthly',variant:process.env.DCA_VARIANT??'classic',allocation:process.env.DCA_ALLOCATION??'70/30'},
  deposits:sqlite.prepare('SELECT period,ts,amount FROM dca_paper_deposits WHERE account_id=? ORDER BY ts').all('dca'),
  decisions:sqlite.prepare('SELECT period,ts,variant,status,reason FROM dca_paper_decisions WHERE account_id=? ORDER BY ts DESC LIMIT 100').all('dca')
 }));
 app.get('/api/accounts',()=>db.select().from(accounts).all().map(a=>{const positionsNow=db.select().from(positions).where(eq(positions.accountId,a.id)).all();const ts=db.select().from(trades).where(eq(trades.accountId,a.id)).all();const valuation=broker.valuation(a.id),equity=valuation.equity;
  const deposits=a.strategy==='dca'?(sqlite.prepare('SELECT coalesce(sum(amount),0) AS amount FROM dca_paper_deposits WHERE account_id=?').get(a.id) as {amount:number}).amount:0;
  const capital=a.startingBalance+deposits;
  return {...a,equity,valuation,contributed:deposits,pnlEur:equity===null?null:equity-capital,pnlPct:equity===null||capital<=0?null:(equity/capital-1)*100,fees:ts.reduce((s,t)=>s+t.feeEur,0),positionCount:positionsNow.length,drawdownPct:equity===null?null:a.peakEquity>0?(a.peakEquity-equity)/a.peakEquity*100:0};}));
 app.get('/api/accounts/:id/positions',(req,reply)=>{const {id}=req.params as {id:string};if(!db.select().from(accounts).where(eq(accounts.id,id)).get())return reply.code(404).send({error:'Unbekanntes Konto'});return broker.valuation(id).positions;});
 app.get('/api/trades',(req)=>{const q=z.object({accountId:z.string().optional(),pair:z.string().optional(),limit:z.coerce.number().min(1).max(2000).default(150)}).parse(req.query);return db.select().from(trades).where(and(q.accountId?eq(trades.accountId,q.accountId):undefined,q.pair?eq(trades.pair,q.pair):undefined)).orderBy(desc(trades.ts)).limit(q.limit).all();});
 app.get('/api/decisions',(req)=>{const q=z.object({accountId:z.string().optional(),limit:z.coerce.number().min(1).max(500).default(100)}).parse(req.query);return db.select().from(decisions).where(q.accountId?eq(decisions.accountId,q.accountId):undefined).orderBy(desc(decisions.ts)).limit(q.limit).all();});
 app.get('/api/decisions/:id/evidence',(req)=>{const {id}=req.params as {id:string};const row=sqlite.prepare('SELECT evidence_json,recorded_at FROM decision_evidence WHERE decision_id=?').get(id) as {evidence_json:string;recorded_at:number}|undefined;return row?{available:true,recordedAt:row.recorded_at,evidence:JSON.parse(row.evidence_json)}:{available:false,reason:'No original provider receipt recorded; older decisions are not retroactively attributed'};});
 app.get('/api/decisions/:id',(req,reply)=>{const {id}=req.params as {id:string};const row=db.select().from(decisions).where(eq(decisions.id,id)).get();return row??reply.code(404).send({error:'Nicht gefunden'});});
 app.get('/api/equity',(req)=>{const q=z.object({accountId:z.string().optional(),from:z.coerce.number().optional()}).parse(req.query);return db.select().from(equitySnapshots).where(and(q.accountId?eq(equitySnapshots.accountId,q.accountId):undefined,q.from?gte(equitySnapshots.ts,q.from):undefined)).orderBy(equitySnapshots.ts).limit(10000).all();});
 app.get('/api/lessons',()=>db.select().from(lessons).orderBy(desc(lessons.createdAt)).all());
 app.post('/api/lessons',(req,reply)=>{const r=z.object({text:z.string().min(1).max(3000),source:z.string().min(1).max(100).default('manuell')}).safeParse(req.body);if(!r.success)return reply.code(400).send({error:'Ungültiger Text'});const row={id:randomUUID(),text:r.data.text,source:r.data.source,active:true,createdAt:Date.now()};db.insert(lessons).values(row).run();return row;});
 app.patch('/api/lessons/:id',(req,reply)=>{const p=z.object({text:z.string().min(1).max(3000).optional(),active:z.boolean().optional()}).safeParse(req.body);if(!p.success)return reply.code(400).send({error:'Ungültige Änderung'});const {id}=req.params as {id:string};db.update(lessons).set(p.data).where(eq(lessons.id,id)).run();return db.select().from(lessons).where(eq(lessons.id,id)).get()??reply.code(404).send({error:'Nicht gefunden'});});
 app.get('/api/memory',()=>{const total=db.select({n:sql<number>`count(*)`}).from(memoryEntries).get()?.n??0;const done=db.select({n:sql<number>`count(*)`}).from(memoryEntries).where(sql`change_4h IS NOT NULL`).get()?.n??0;return {total,withOutcome:done};});
 app.get('/api/analytics',()=>db.select().from(accounts).all().map(a=>({accountId:a.id,name:a.name,status:a.status,...computeAccountAnalytics(db.select().from(trades).where(eq(trades.accountId,a.id)).all(),db.select().from(equitySnapshots).where(eq(equitySnapshots.accountId,a.id)).orderBy(equitySnapshots.ts).all(),broker.equity(a.id))})));
 app.get('/api/portfolio-risk',()=>{
  const latest=sqlite.prepare('SELECT pair,ts,requested,approved,allowed,state,reasons,portfolio_vol AS portfolioVol,btc_beta AS btcBeta,cluster_pct AS clusterPct,drawdown FROM portfolio_risk_audit WHERE account_id=? ORDER BY id DESC LIMIT 1');
  const halted=sqlite.prepare('SELECT halted,updated_at AS updatedAt,reason FROM portfolio_risk_latches WHERE account_id=?');
  const asOf=Date.now(),limits={...DEFAULT_RISK_LIMITS,
   targetAnnualVol:Number(process.env.TARGET_PORTFOLIO_VOL??DEFAULT_RISK_LIMITS.targetAnnualVol)};
  return {paperOnly:true,asOf,limits,
   accounts:db.select().from(accounts).all().filter(a=>a.strategy==='rules'||a.strategy==='ai').map(a=>{
    let current:ReturnType<typeof inspectPortfolioRisk>|null=null;
    try {
     const snapshot=paperRiskSnapshot(sqlite,broker,market,a.id,'BTC/'+config.QUOTE_CURRENCY,
      config.QUOTE_CURRENCY,asOf);
     current=inspectPortfolioRisk(snapshot,limits);
    }catch{/* An unavailable or malformed diagnostic is unknown, never an approval. */}
    return {
     accountId:a.id,name:a.name,status:a.status,
     latched:(halted.get(a.id) as {halted:number}|undefined)?.halted===1,
     last:(latest.get(a.id)??null),current
    };
   }),
   note:'Current exposure uses validated market observations and closed risk history. Missing inputs stay unknown; last audit is historical, not live authorization. Reset requires local acknowledgement.'};
 });
 app.get('/api/health',()=>{const now=Date.now();const active=db.select().from(pairs).where(eq(pairs.active,true)).all();const fresh=active.filter(p=>{const b=market.books.get(p.symbol);return !!b&&b.valid&&now-b.receivedAt<=config.MAX_BOOK_AGE_MS;}).length;
  const features=active.filter(p=>{const f=market.features.get(p.symbol);return !!f&&now-(f.ts+15*60000)<30*60000;}).length;
  const lastTrade=db.select().from(trades).orderBy(desc(trades.ts)).limit(1).get();const recentRejects=db.select().from(rejectedOrders).where(gte(rejectedOrders.ts,now-24*3600000)).all();
  return {connected:market.connected,checkedAt:now,paperOnly:true,pairs:active.length,freshBooks:fresh,readyFeatures:features,staleBooks:active.length-fresh,trackedAccounts:3,protectiveExitFailures:new SqliteExitFailures(sqlite).all().length,rejections24h:recentRejects.length,lastTradeAt:lastTrade?.ts??null,feeRate:config.TAKER_FEE_RATE,disclaimer:'Verbindungsqualität und vergangene Handelsdaten sind keine Gewinnprognose.'};});
 // Single-pair OHLC research: GET only, deterministic and entirely isolated from the live broker.
 app.get('/api/research',(req,reply)=>{const parsed=z.object({pair:z.string().min(3).max(30),strategy:z.enum(['trend','breakout','defensive','quality']).default('quality'),slippageBps:z.coerce.number().min(0).max(150).default(8)}).safeParse(req.query);
  if(!parsed.success)return reply.code(400).send({error:'Ungültige Research-Parameter'});
  const q=parsed.data;const exists=db.select().from(pairs).where(eq(pairs.symbol,q.pair)).get();if(!exists)return reply.code(404).send({error:'Unbekanntes Börsenpaar'});
  const now=Date.now();const rows=db.select().from(candles).where(and(eq(candles.pair,q.pair),eq(candles.interval,15),lte(candles.ts,now-15*60000))).orderBy(desc(candles.ts)).limit(12000).all().reverse();
  try{const options={strategy:q.strategy,startingBalance:config.STARTING_BALANCE_EUR,feeRate:config.TAKER_FEE_RATE,slippagePct:q.slippageBps/10000};return {...runResearch(q.pair,rows,options),robustness:analyzeRobustness(rows,options)};}
  catch(error){return reply.code(422).send({error:error instanceof Error?error.message:'Nicht genügend historische Daten'});}
 });
 app.get('/api/rejected_orders',()=>db.select().from(rejectedOrders).orderBy(desc(rejectedOrders.ts)).limit(150).all());
 for(const action of ['pause','resume'] as const)app.post(`/api/accounts/:id/${action}`,(req,reply)=>{const {id}=req.params as {id:string};const a=db.select().from(accounts).where(eq(accounts.id,id)).get();if(!a)return reply.code(404).send({error:'Unbekanntes Konto'});if(a.strategy==='hold'||a.strategy==='ai'&&config.AI_PROVIDER==='none')return reply.code(400).send({error:'Dieses Konto kann nicht manuell umgeschaltet werden'});
 if(action==='resume'&&new SqliteExitFailures(sqlite).has(id))return reply.code(409).send({error:'Ungelöster Schutzverkauf: Konto bleibt pausiert, Schutzverkäufe bleiben aktiv.'});
 const status=action==='pause'?'paused':'active';const newPeak=action==='resume'?broker.equity(id):a.peakEquity;if(newPeak===null)return reply.code(409).send({error:'Bestände sind nicht frisch bewertet; Fortsetzen bleibt gesperrt.'});db.update(accounts).set({status,peakEquity:newPeak}).where(eq(accounts.id,id)).run();return {id,status,peakEquity:newPeak};});
}
