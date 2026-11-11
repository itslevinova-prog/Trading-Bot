import {expect,test,vi} from 'vitest';
const calls=vi.hoisted(()=>({transaction:vi.fn(),backup:vi.fn(async()=>{throw Error('no space');})}));
vi.mock('../src/backup/backup.js',()=>({runBackup:calls.backup}));
vi.mock('../src/research/forward.js',()=>({invalidateForward:vi.fn()}));
vi.mock('../src/config.js',()=>({projectRoot:'/temp-only',config:{STARTING_BALANCE_EUR:100,AI_PROVIDER:'none',AI_ENABLED:false}}));
vi.mock('../src/db.js',()=>({sqlite:{transaction:calls.transaction,close:vi.fn()}}));
test('reset refuses database changes when mandatory backup fails',async()=>{
 await expect(import('../src/reset.js')).rejects.toThrow('no space');
 expect(calls.backup).toHaveBeenCalledOnce();
 expect(calls.transaction).not.toHaveBeenCalled();
});
