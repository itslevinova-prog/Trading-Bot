import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {config} from './config.js';
if(process.env.LIVE_ENABLED!=='true'){console.log('Live/Testnet deaktiviert. Keine Anfragen.');process.exit(0);}
let stopping=false,child:ReturnType<typeof spawn>|undefined,wake:(()=>void)|undefined;
const stop=()=>{stopping=true;child?.kill();wake?.();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
while(!stopping){
 child=spawn(process.execPath,[fileURLToPath(new URL('./live-cycle.js',import.meta.url))],{stdio:'inherit',env:process.env,windowsHide:true});
 const exitCode=await new Promise<number|null>((resolve,reject)=>{child!.once('error',reject);child!.once('exit',resolve);});child=undefined;
 if(exitCode!==0){console.error('Live-Zyklus fehlgeschlagen. Runner stoppt; kein automatischer Retry.');break;}
 const interval=config.DECISION_INTERVAL_MINUTES*60000,now=Date.now(),next=(Math.floor((now-5000)/interval)+1)*interval+5000;
 if(!stopping)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,next-now);wake=()=>{clearTimeout(timer);resolve();};});wake=undefined;
}
