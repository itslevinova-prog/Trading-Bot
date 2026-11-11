import {requireAccountPaperAdmission} from './pipeline/paper.js';
import {PaperPortfolioRiskGateway} from './risk-engine/paper.js';
import {LiveCoinQualityProvider} from './coin-quality/providers.js';
import {readQualityConfig} from './coin-quality/contracts.js';
import {requireCoinQualityEntry} from './coin-quality/admission.js';
import {startBackupScheduler} from './backup/scheduler.js';
import {registerPaperTestRoutes} from './api/paper-test.js';
import {startPublicWsActivityCapture} from './market/ws-activity-capture.js';
import {MarketBootstrap} from './market/bootstrap.js';
import {PaperExperimentRuntimeController} from './research/paper-experiment-runtime.js';
import {inspectBuild,createRuntimeProvenance,recordDeployment} from './provenance/build.js';
import Fastify from 'fastify';import websocket from '@fastify/websocket';import staticPlugin from '@fastify/static';import {resolve} from 'node:path';import {existsSync} from 'node:fs';
import {config,projectRoot} from './config.js';import {sqlite,initAccounts} from './db.js';import {registerRoutes} from './api/routes.js';import {KrakenMarket} from './market/kraken.js';import {BinanceMarket} from './market/binance.js';import {PaperExecutionAdapter} from './broker/PaperExecutionAdapter.js';import {Scheduler} from './strategy/scheduler.js';
const app=Fastify({logger:{level:config.LOG_LEVEL,transport:process.env.NODE_ENV==='development'?{target:'pino-pretty'}:undefined}});
await app.register(websocket);
const clients=new Set<{send:(m:string)=>void;readyState:number}>();const emit=(type:string,payload:unknown)=>{const msg=JSON.stringify({type,payload});for(const client of clients)if(client.readyState===1){try{client.send(msg)}catch{clients.delete(client)}}};
const provenance=createRuntimeProvenance(inspectBuild(projectRoot),config);if(!provenance.verified)app.log.warn({reasons:provenance.build.reasons},'Build provenance unverified; results cannot be labelled independent evidence');
const activityCapture=startPublicWsActivityCapture({enabled:process.env.PAPER_PUBLIC_ACTIVITY_CAPTURE==='true',projectRoot,mainDatabasePath:config.DATABASE_PATH,runtime:provenance,paperOnly:true,liveEnabled:process.env.LIVE_ENABLED==='true',warn:message=>app.log.warn(message)});if(activityCapture)app.log.info(activityCapture.status(),'Public closed activity capture enabled; strategy unchanged');
const market=config.EXCHANGE==='binance'?new BinanceMarket(app.log,emit,(symbol,bid)=>{portfolioRisk.observeConnection();scheduler.onTick(symbol,bid);},activityCapture?.observe):new KrakenMarket(app.log,emit,(symbol,bid)=>{portfolioRisk.observeConnection();scheduler.onTick(symbol,bid);});const broker=new PaperExecutionAdapter(market,emit,provenance);broker.setPipelineEntryGuard((accountId,strategy)=>{requireAccountPaperAdmission(projectRoot,{id:accountId,strategy});});
// All strategy entry paths converge at the broker gate. Unknown public status is a veto.
const coinQuality=new LiveCoinQualityProvider({...readQualityConfig(),quote:config.QUOTE_CURRENCY});
broker.setCoinQualityGuard(async(pair,asOf)=>config.EXCHANGE==='binance'?
 requireCoinQualityEntry(coinQuality,pair,asOf,'paper'):
 {allowed:false,reason:'Coin quality has no validated Kraken source; entries blocked'});
const portfolioRisk=new PaperPortfolioRiskGateway(sqlite,broker,market,config.QUOTE_CURRENCY);
broker.setPortfolioRiskGuard((accountId,pair,amount)=>portfolioRisk.evaluateBuy(accountId,pair,amount));
const experiment=config.PAPER_EXPERIMENT_MODE==='mock'?new PaperExperimentRuntimeController(sqlite,broker,market,config,projectRoot,process.env.LIVE_ENABLED==='false'):undefined;const scheduler=new Scheduler(market,broker,emit,app.log,experiment);
initAccounts();registerRoutes(app,market,broker,changed=>{for(const pair of changed){const book=market.books.get(pair);if(book?.valid&&Date.now()>=book.receivedAt&&Date.now()-book.receivedAt<=config.MAX_BOOK_AGE_MS){const bid=Number(book.bids[0]?.price);if(Number.isFinite(bid)&&bid>0)scheduler.onTick(pair,bid);}}});
registerPaperTestRoutes(app,market,broker,()=>scheduler.run('ai'));
if(experiment)app.get('/api/paper-experiment',()=>experiment.report());
app.get('/ws',{websocket:true},socket=>{clients.add(socket);socket.on('close',()=>clients.delete(socket));socket.send(JSON.stringify({type:'system_status',payload:{connected:market.connected,paperOnly:true}}));});
const staticRoot=resolve(projectRoot,'apps/web/dist');if(existsSync(staticRoot)){await app.register(staticPlugin,{root:staticRoot,prefix:'/'});app.setNotFoundHandler((req,reply)=>{if(req.url.startsWith('/api/'))return reply.code(404).send({error:'Route nicht gefunden'});return reply.sendFile('index.html');});}
const port=config.PORT;await app.listen({port,host:process.env.DOCKER==='true'?'0.0.0.0':'127.0.0.1'});recordDeployment(projectRoot,provenance);
const stopBackupScheduler=startBackupScheduler(projectRoot,{info:message=>app.log.info(message),error:message=>app.log.error(message)});
app.log.info(`Paper bot running at http://127.0.0.1:${port} (public ${config.EXCHANGE} Spot API)`);
const bootstrap=new MarketBootstrap(async()=>{await market.start();app.log.info('Market feed connected');},()=>scheduler.start(),experiment?()=>{experiment.start();}:undefined);
bootstrap.startNormalScheduler();const begin=()=>bootstrap.begin().catch(e=>app.log.warn({error:e},'Market/experiment unavailable; retrying in30s'));
void begin();const retry=setInterval(()=>void begin(),30000);
let shuttingDown=false;async function shutdown(){if(shuttingDown)return;shuttingDown=true;stopBackupScheduler();bootstrap.stop();clearInterval(retry);market.stop();activityCapture?.close();await scheduler.stop();await app.close();sqlite.close();process.exit(0)}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
