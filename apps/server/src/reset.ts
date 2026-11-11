import {runBackup} from './backup/backup.js';
import {invalidateForward} from './research/forward.js';
import {sqlite} from './db.js';import {config,projectRoot} from './config.js';
const full=process.argv.includes('--full');
await runBackup({root:projectRoot});
sqlite.transaction(()=>{
invalidateForward(sqlite,'Paper account reset; previous baseline cannot be reused');
for(const table of ['positions','trades','rejected_orders','decisions','equity_snapshots'])sqlite.exec(`DELETE FROM ${table}`);
if(full)for(const table of ['memory_entries','candles','lessons','pairs'])sqlite.exec(`DELETE FROM ${table}`);
sqlite.prepare('UPDATE accounts SET cash=?,peak_equity=?,status=CASE WHEN strategy = ? THEN ? ELSE ? END').run(config.STARTING_BALANCE_EUR,config.STARTING_BALANCE_EUR,'ai',(config.AI_PROVIDER==='mock'||config.AI_ENABLED&&config.AI_PROVIDER==='openai-compatible')?'active':'inactive','active');
})();
console.log(`Zurückgesetzt (${full?'alles':'Konten/Trades/Entscheidungen'})`);sqlite.close();
