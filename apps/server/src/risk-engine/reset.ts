import {sqlite} from '../db.js';
import {resetStoredPortfolioRisk} from './paper.js';

function main(argv:string[]){
 if(process.env.LIVE_ENABLED==='true')throw Error('Paper risk reset is disabled when LIVE_ENABLED=true');
 if(argv.length!==4||argv[0]!=='--account'||argv[2]!=='--ack')
  throw Error('Usage: pnpm risk:reset --account rules|ai --ack I_ACKNOWLEDGE_MANUAL_RISK_RESET');
 resetStoredPortfolioRisk(sqlite,argv[1]!,argv[3]!);
 console.log('Local paper risk latch reset recorded. Restart the paper server; every market/data risk check still applies.');
}
try{main(process.argv.slice(2));}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}finally{sqlite.close();}
