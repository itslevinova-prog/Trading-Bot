import {expect,test} from 'vitest';
import {shouldRunBackup} from '../src/backup/scheduler.js';
test('scheduler uses local HH:mm and does not repeat the same local day',()=>{
 const at=new Date(2026,10,5,3,30);
 expect(shouldRunBackup(at,'03:30',null)).toBe(true);
 expect(shouldRunBackup(at,'03:30','2026-11-5')).toBe(false);
 expect(shouldRunBackup(new Date(2026,10,5,3,29),'03:30',null)).toBe(false);
 expect(()=>shouldRunBackup(at,'99:00',null)).toThrow();
});
