import {expect,test} from 'vitest';import {parseAiAnswer} from '@paper/shared';
const pairs=new Set(['BTC/EUR']);
test('valid buy JSON',()=>{const r=parseAiAnswer(JSON.stringify({marketView:'Ruhig',actions:[{type:'buy',pair:'BTC/EUR',amountEur:20,stopLossPct:.05,confidence:.7,reasoning:'Signal'}]}),pairs);expect(r.valid).toBe(true);expect(r.actions).toHaveLength(1);});
test('partially invalid actions are ignored',()=>{const r=parseAiAnswer(JSON.stringify({marketView:'Neutral',actions:[{type:'hold',confidence:.8,reasoning:'Warten'},{type:'buy',pair:'BTC/EUR',amountEur:-5,stopLossPct:.05,confidence:.7,reasoning:'Falsch'}]}),pairs);expect(r.valid).toBe(true);expect(r.actions).toHaveLength(1);expect(r.errors).toHaveLength(1);});
test('invalid JSON or schema rejected',()=>{expect(parseAiAnswer('not-json',pairs).valid).toBe(false);expect(parseAiAnswer('{"actions":[]}',pairs).valid).toBe(false);});
