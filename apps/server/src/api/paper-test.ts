import type {FastifyInstance} from 'fastify';import {eq,desc} from 'drizzle-orm';
import {db} from '../db.js';import {accounts,decisions,trades} from '../schema.js';import {config} from '../config.js';import type {MarketFeed} from '../market/types.js';import type {PaperExecutionAdapter} from '../broker/PaperExecutionAdapter.js';
export function registerPaperTestRoutes(app:FastifyInstance,market:MarketFeed,broker:PaperExecutionAdapter,runAi:()=>Promise<'completed'|'busy'|'stopping'>){
 const enabled=()=>config.PAPER_TEST_MODE&&config.AI_PROVIDER==='mock'&&!config.AI_ENABLED&&!config.AI_ALLOW_REMOTE&&config.PAPER_EXPERIMENT_MODE==='off';let inFlight=false,lastCheckAt:number|null=null;
 const snapshot=()=>{
  const account=db.select().from(accounts).where(eq(accounts.id,'ai')).get(),latest=db.select().from(decisions).where(eq(decisions.accountId,'ai')).orderBy(desc(decisions.ts)).limit(1).get();let actions:unknown[]=[];try{const parsed=JSON.parse(latest?.actionsJson??'[]');if(Array.isArray(parsed))actions=parsed;}catch{}
  const now=Date.now(),freshBooks=[...market.books.values()].filter(b=>b.valid&&b.receivedAt<=now&&now-b.receivedAt<=config.MAX_BOOK_AGE_MS).length;
  return {available:enabled(),paperOnly:true,engine:'simulated-strategy',engineLabel:'Simulierte KI-Strategie · kein externes KI-Modell',connected:market.connected,freshBooks,readyFeatures:market.features.size,accountStatus:account?.status??'missing',cash:account?.cash??null,policy:broker.policies.get('ai'),decisionIntervalMinutes:config.DECISION_INTERVAL_MINUTES,busy:inFlight,latestDecision:latest?{id:latest.id,ts:latest.ts,status:latest.status,provider:latest.provider,marketView:latest.marketView,actions}:null,tradeCount:db.select().from(trades).where(eq(trades.accountId,'ai')).all().length,profitabilityEstablished:false};
 };
 app.get('/api/paper-test',snapshot);
 app.post('/api/paper-test/check',async(req,reply)=>{
  const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host)return reply.code(403).send({error:'Fremde Origin nicht erlaubt'});}catch{return reply.code(403).send({error:'Ungültige Origin'});}}
  if(!enabled())return reply.code(409).send({error:'Kostenloses Paper-Testprofil ist nicht aktiv.'});
  if(db.select().from(accounts).where(eq(accounts.id,'ai')).get()?.status!=='active')return reply.code(409).send({error:'Paper-Test zuerst starten.'});
  const status=snapshot();if(!status.connected||status.freshBooks===0||status.readyFeatures===0)return reply.code(409).send({error:'Marktdaten werden noch geladen. Bitte gleich erneut prüfen.'});
  if(inFlight||lastCheckAt!==null&&Date.now()-lastCheckAt<10000)return reply.code(429).send({error:'Prüfung läuft oder wurde gerade ausgeführt. Bitte kurz warten.'});
  inFlight=true;try{const result=await runAi();if(result!=='completed')return reply.code(409).send({error:'Ein Strategiezyklus läuft bereits oder wird beendet.'});lastCheckAt=Date.now();return {...snapshot(),busy:false,checked:true};}finally{inFlight=false;}
 });
}
