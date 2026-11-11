import {renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {recorderConfig,loadRecorderUniverse} from './configuration.js';
import {RecorderBooks} from './books.js';
import {MonthlyMarketStore,monthOf} from './storage.js';
import {RecorderTransport} from './transport.js';
import {acquireRecorderLock} from './lock.js';
import type {RecorderEvent,RecorderHeartbeat} from './types.js';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const dir=join(root,'data','recordings');
const startedAt=Date.now();
const config=recorderConfig(process.env,dir);
const release=acquireRecorderLock(join(dir,'.lock'));
let store:MonthlyMarketStore|undefined;
let transport:RecorderTransport|undefined;
let sampleTimer:NodeJS.Timeout|undefined,flushTimer:NodeJS.Timeout|undefined;
let status:RecorderHeartbeat['status']='starting',lastMessageAt:number|null=null;
let pausedAt:number|null=null,stopping=false,queuedWarning=false,overflowAt:number|null=null;
let selectedPairCount=0;
const deferredEvents:RecorderEvent[]=[];
const log=(msg:string)=>console.log(new Date().toISOString()+' [recorder] '+msg);
const onEvent=(e:RecorderEvent)=>{
  if(pausedAt!==null){if(deferredEvents.length<2000)deferredEvents.push(e);}
  else store?.appendEvent(e);
};
function heartbeat(pairCount:number){
  const now=Date.now();
  const payload:RecorderHeartbeat={startedAt,updatedAt:now,lastWriteAt:store?.lastWriteAt??null,
    lastMessageAt,pairCount,status,queued:store?.queued??0,month:monthOf(now)};
  const tmp=join(dir,'heartbeat-'+process.pid+'.tmp');
  try{writeFileSync(tmp,JSON.stringify(payload,null,2)+'\n');renameSync(tmp,join(dir,'heartbeat.json'));}
  catch(error){log('Heartbeat unavailable: '+String(error));}
}
async function main(){
  try{
    if(!process.env.RECORD_PAIRS)log('Selecting top USDT-liquidity bases and available USDC/EUR spot quotes');
    const universe=await loadRecorderUniverse(config);
    if(stopping)return;
    const symbols=universe.symbols;
    selectedPairCount=symbols.length;
    store=new MonthlyMarketStore(dir,symbols,startedAt,config.snapshotMs,config.minFreeGb);
    if(!store.hasSpace())throw Error('Not enough free disk space to begin recorder');
    const books=new RecorderBooks(config.staleMs,onEvent);
    const checkDisk=()=>{
      if(!store)return;
      const now=Date.now(),space=store.hasSpace();
      if(!space&&pausedAt===null){
        pausedAt=now;status='paused_disk';
        const dropped=store.discardPending();
        deferredEvents.push({ts:now,symbol:null,type:'storage_paused',detail:'Insufficient free disk space; dropped pending rows: '+dropped});
        for(const symbol of symbols)deferredEvents.push({ts:now,symbol,type:'gap_start',detail:'storage_paused'});
        log('PAUSED: free disk space below '+config.minFreeGb+' GiB. Writes and capture stopped.');
      }else if(space&&pausedAt!==null){
        const from=pausedAt;pausedAt=null;
        for(const e of deferredEvents.splice(0))store.appendEvent(e);
        for(const symbol of symbols)store.appendEvent({ts:now,symbol,type:'gap_end',detail:String(now-from)});
        store.appendEvent({ts:now,symbol:null,type:'storage_resumed'});
        status=transport&&transport.connectedCount===transport.totalCount?'recording':'reconnecting';
        log('Recording resumed after disk-space recovery.');
      }
      if(space){
        try{const n=store.flush();if(n>0&&queuedWarning){
          store.appendEvent({ts:overflowAt??now,symbol:null,type:'queue_overflow',detail:'Marktdaten wegen gefuelltem RAM-Batch verworfen'});
          store.flush();overflowAt=null;log('Writer queue recovered.');queuedWarning=false;}}
        catch(error){log('FATAL SQLite batch write: '+String(error));void shutdown(1);}
      }
      heartbeat(symbols.length);
    };
    transport=new RecorderTransport({
      symbols,tradeSymbols:universe.tradeSymbols,books,
      onTrade:t=>{if(pausedAt!==null||!store)return;
        if(!store.appendTrade(t)&&!queuedWarning){queuedWarning=true;overflowAt=Date.now();log('Writer queue full; dropping incoming trades until next flush');}},
      onMessage:ts=>{lastMessageAt=ts;},
      onStatus:(connected,total)=>{if(pausedAt===null)status=connected===total?'recording':'reconnecting';},
      log,
    },config.socketPairLimit);
    if(stopping)return;
    if(!store.hasSpace())throw Error('Insufficient free disk space');
    heartbeat(symbols.length);
    transport.start();
    sampleTimer=setInterval(()=>{
      const now=Date.now();books.markStale(now);
      if(pausedAt!==null||!store)return;
      for(const symbol of symbols){const snapshot=books.snapshot(symbol,now,config.snapshotMs);if(snapshot&&!store.appendBook(snapshot)&&!queuedWarning){
        queuedWarning=true;overflowAt=now;log('Writer queue full; sampling skipped');}}
    },config.snapshotMs);
    flushTimer=setInterval(checkDisk,config.flushMs);
    log('Started '+symbols.length+' pairs; aggregate trades '+universe.tradeSymbols.size+
      '; '+transport.totalCount+' WebSocket connections; '+dir);
  }catch(error){log('Recorder startup failed: '+String(error));await shutdown(1);}
}
async function shutdown(exitCode=0){
  if(stopping)return;stopping=true;status='stopping';
  if(sampleTimer)clearInterval(sampleTimer);
  if(flushTimer)clearInterval(flushTimer);
  transport?.stop();
  if(store){try{if(store.hasSpace())store.flush();else log('Final flush skipped: disk below safety threshold');}
    catch(error){log('Final batch could not be saved: '+String(error));exitCode=1;}
    store.close();}
  status='stopped';
  if(store)heartbeat(selectedPairCount);
  release();process.exitCode=exitCode;
}
process.on('SIGINT',()=>{void shutdown();});
process.on('SIGTERM',()=>{void shutdown();});
await main();
