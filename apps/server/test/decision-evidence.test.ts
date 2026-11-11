import {aggregate} from '../src/context/market-context.js';
import {feature} from '../src/market/indicators.js';
import {SYSTEM_PROMPT} from '../src/ai/prompt.js';
import Fastify from 'fastify';import {registerRoutes} from '../src/api/routes.js';
import {test,expect,vi} from 'vitest';import {eq} from 'drizzle-orm';import type {FeatureSnapshot} from '@paper/shared';import type {FastifyBaseLogger} from 'fastify';import {db,sqlite} from '../src/db.js';import {accounts,positions,decisions,decisionEvidence} from '../src/schema.js';import {Scheduler} from '../src/strategy/scheduler.js';import {RuleBasedProvider} from '../src/strategy/providers.js';import {PaperExecutionAdapter} from '../src/broker/PaperExecutionAdapter.js';import type {MarketFeed} from '../src/market/types.js';import {config} from '../src/config.js';import {modelFixture} from './model-fixture.js';import {sha256} from '../src/ai/model-identity.js';
const id='durable-input-fixture',logger={error:vi.fn(),warn:vi.fn(),info:vi.fn()} as unknown as FastifyBaseLogger;
function account(strategy='rules'){db.delete(positions).where(eq(positions.accountId,id)).run();db.delete(decisions).where(eq(decisions.accountId,id)).run();db.delete(accounts).where(eq(accounts.id,id)).run();db.insert(accounts).values({id,name:id,strategy,cash:100,startingBalance:100,peakEquity:100,status:'active',createdAt:Date.now()}).run();}
const market=()=>({venue:'binance',connected:true,tickers:new Map(),books:new Map(),features:new Map()} as unknown as MarketFeed);
test('validated decision and original full context are durable before a broker action',async()=>{account();const m=market(),broker=new PaperExecutionAdapter(m,()=>{}),scheduler=new Scheduler(m,broker,()=>{},logger),decide=vi.spyOn(RuleBasedProvider.prototype,'decide').mockImplementation(async c=>(c.account as {id:string}).id===id?{marketView:'fixture',actions:[{type:'buy',pair:'BTC/EUR',amountEur:10,stopLossPct:.05,confidence:1,reasoning:'fixture'}]}:{marketView:'other',actions:[]}),place=vi.spyOn(broker,'placeMarketOrder').mockImplementation(async order=>{const row=db.select().from(decisions).where(eq(decisions.id,order.decisionId)).get()!;expect(row.status).toBe('validated');expect(JSON.parse(row.contextJson!).account.id).toBe(id);return {ok:true,reason:'fixture only'};});try{await scheduler.run();expect(place).toHaveBeenCalledTimes(1);}finally{await scheduler.stop();decide.mockRestore();place.mockRestore();}});
test('unavailable initial input storage prevents consulting the provider',async()=>{account();sqlite.exec("CREATE TRIGGER fail_initial_input BEFORE INSERT ON decisions WHEN NEW.account_id='durable-input-fixture' BEGIN SELECT RAISE(ABORT,'fixture input unavailable'); END;");const m=market(),scheduler=new Scheduler(m,new PaperExecutionAdapter(m,()=>{}),()=>{},logger),decide=vi.spyOn(RuleBasedProvider.prototype,'decide').mockResolvedValue({marketView:'fixture',actions:[]});try{await expect(scheduler.run()).rejects.toThrow();expect(decide.mock.calls.filter(([c])=>(c.account as {id:string}).id===id)).toHaveLength(0);}finally{sqlite.exec('DROP TRIGGER fail_initial_input');await scheduler.stop();decide.mockRestore();}});
test('unavailable validated-result storage prevents orders even after a provider answer',async()=>{account();sqlite.exec("CREATE TRIGGER fail_validated_input BEFORE UPDATE OF status ON decisions WHEN NEW.account_id='durable-input-fixture' AND NEW.status='validated' BEGIN SELECT RAISE(ABORT,'fixture policy unavailable'); END;");const m=market(),broker=new PaperExecutionAdapter(m,()=>{}),place=vi.spyOn(broker,'placeMarketOrder'),scheduler=new Scheduler(m,broker,()=>{},logger),decide=vi.spyOn(RuleBasedProvider.prototype,'decide').mockImplementation(async c=>(c.account as {id:string}).id===id?{marketView:'fixture',actions:[{type:'buy',pair:'BTC/EUR',amountEur:10,stopLossPct:.05,confidence:1,reasoning:'fixture'}]}:{marketView:'other',actions:[]});try{await scheduler.run();expect(place).not.toHaveBeenCalled();expect(db.select().from(decisions).where(eq(decisions.accountId,id)).get()).toMatchObject({status:'invalid'});}finally{sqlite.exec('DROP TRIGGER fail_validated_input');await scheduler.stop();decide.mockRestore();place.mockRestore();}});
async function localEvidence(failReceipt:boolean){account('ai');const f=await modelFixture(),saved={AI_ENABLED:config.AI_ENABLED,AI_PROVIDER:config.AI_PROVIDER,AI_BASE_URL:config.AI_BASE_URL,AI_MODEL:config.AI_MODEL,AI_MODEL_MODE:config.AI_MODEL_MODE,AI_EXPECTED_MODEL_FINGERPRINT:config.AI_EXPECTED_MODEL_FINGERPRINT,AI_CONTEXT_TOKENS:config.AI_CONTEXT_TOKENS};Object.assign(config,{AI_ENABLED:true,AI_PROVIDER:'openai-compatible',AI_BASE_URL:f.options.baseUrl,AI_MODEL:f.options.model,AI_MODEL_MODE:'ollama-local',AI_EXPECTED_MODEL_FINGERPRINT:f.identity.fingerprint,AI_CONTEXT_TOKENS:65536});vi.stubGlobal('fetch',f.request);const m=market(),broker=new PaperExecutionAdapter(m,()=>{}),place=vi.spyOn(broker,'placeMarketOrder'),scheduler=new Scheduler(m,broker,()=>{},logger);if(failReceipt)sqlite.exec("CREATE TRIGGER fail_model_receipt BEFORE INSERT ON decision_evidence WHEN json_extract(NEW.evidence_json,'$.phase')='prepared' AND NEW.decision_id IN(SELECT id FROM decisions WHERE account_id='durable-input-fixture') BEGIN SELECT RAISE(ABORT,'fixture receipt unavailable'); END;");f.state.onChat=()=>{const row=db.select().from(decisions).where(eq(decisions.accountId,id)).get()!,receipt=db.select().from(decisionEvidence).where(eq(decisionEvidence.decisionId,row.id)).get()!;expect(row.status).toBe('prepared');const input=JSON.parse(row.contextJson!);expect(input.modelIdentity.fingerprint).toBe(f.identity.fingerprint);expect(row.promptText).toBe(f.state.packet.messages[0].content+'\n\n'+f.state.packet.messages[1].content);expect(JSON.parse(receipt.evidenceJson).requestBodyHash).toBe(sha256(JSON.stringify(f.state.packet)));};try{await scheduler.run();expect(place).not.toHaveBeenCalled();const row=db.select().from(decisions).where(eq(decisions.accountId,id)).get()!,receipt=JSON.parse(db.select().from(decisionEvidence).where(eq(decisionEvidence.decisionId,row.id)).get()!.evidenceJson);expect(row.status).toBe(failReceipt?'invalid':'hold');expect(f.state.chats).toBe(failReceipt?0:1);expect(receipt).toMatchObject({phase:failReceipt?'rejected':'validated',inferenceAttempted:!failReceipt,modelArtifactVerified:false});const app=Fastify();registerRoutes(app,m,broker);try{expect((await app.inject('/api/decisions/'+row.id+'/evidence')).json()).toMatchObject({available:true,evidence:{phase:failReceipt?'rejected':'validated'}});expect((await app.inject('/api/decisions/missing-provider-receipt/evidence')).json()).toMatchObject({available:false});}finally{await app.close();}}finally{if(failReceipt)sqlite.exec('DROP TRIGGER fail_model_receipt');await scheduler.stop();Object.assign(config,saved);vi.unstubAllGlobals();place.mockRestore();}}
test('actual transmitted prompts and pre/post API identities persist with a local-only model fixture',async()=>{await localEvidence(false);});
test('a failed provider-receipt transaction blocks the model request itself',async()=>{await localEvidence(true);});

test('Paper API and stored mock decision carry the same breadth coverage for twenty markets', async () => {
    account('ai');
    const step = 900000;
    const closeAt = Math.floor(Date.now() / step) * step;
    const now = closeAt + 60000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const settings = { AI_PROVIDER: config.AI_PROVIDER, PAPER_MOCK_POLICY: config.PAPER_MOCK_POLICY };
    Object.assign(config, { AI_PROVIDER: 'mock', PAPER_MOCK_POLICY: 'trend-v2' });
    const feed = market();
    const broker = new PaperExecutionAdapter(feed, () => {});
    const scheduler = new Scheduler(feed, broker, () => {}, logger);
    const place = vi.spyOn(broker, 'placeMarketOrder');
    const app = Fastify();
    const pairs = Array.from({ length: 20 }, (_, i) => 'BREADTHFIXTURE' + i + '/' + config.QUOTE_CURRENCY);
    try {
        const insert = sqlite.prepare('INSERT INTO candles (pair,interval,ts,open,high,low,close,volume) VALUES (@pair,@interval,@ts,@open,@high,@low,@close,@volume)');
        sqlite.transaction(() => {
            for (const [i, pair] of pairs.entries()) {
                const bars = Array.from({ length: 400 }, (_, j) => ({
                    pair, interval: 15, ts: closeAt - (400 - j) * step,
                    open: 100 + j, high: 101 + j, low: 99 + j, close: 100 + j, volume: 10,
                }));
                const hourly = aggregate(bars, 60, now);
                const snapshot = feature(pair, bars, hourly, { bid: 499, ask: 499 }, now)!;
                feed.features.set(pair, i === 1 ? { ...snapshot, ts: snapshot.ts - step } : snapshot);
                for (const [j, bar] of bars.entries()) if (i !== 0 || j !== 303) insert.run(bar);
                for (const bar of hourly) insert.run(bar);
            }
        })();
        registerRoutes(app, feed, broker);
        const response = await app.inject('/api/context');
        expect(response.statusCode).toBe(200);
        const apiBreadth = response.json().breadth;
        expect(apiBreadth).toMatchObject({
            version: 'aligned-market-breadth-v1', closedAt: closeAt, tracked: 20,
            ready: 19, hourlyTrendKnown: 19, aboveHourlyTrend: 19,
            return24hKnown: 19, positive24h: 19, complete: false,
        });
        expect(await scheduler.run(id)).toBe('completed');
        expect(place).not.toHaveBeenCalled();
        const row = db.select().from(decisions).where(eq(decisions.accountId, id)).get()!;
        expect(row).toMatchObject({ provider: 'mock', status: 'hold' });
        expect(JSON.parse(row.contextJson!).marketContext.breadth).toEqual(apiBreadth);
        const packed = row.promptText!.slice(SYSTEM_PROMPT.length + 2);
        expect(packed.length).toBeLessThanOrEqual(config.AI_MAX_CONTEXT_CHARS);
        expect(JSON.parse(packed).marketContext.breadth).toEqual(apiBreadth);
    } finally {
        await scheduler.stop();
        await app.close();
        const cleanup = sqlite.prepare('DELETE FROM candles WHERE pair=?');
        for (const pair of pairs) cleanup.run(pair);
        Object.assign(config, settings);
        place.mockRestore();
        clock.mockRestore();
    }
});
