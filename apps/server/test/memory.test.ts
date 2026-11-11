import {test,expect} from 'vitest';import {statistics,neighbors} from '../src/memory/index.js';
test('z-score dimensions and nearest neighbors',()=>{const stats=statistics([[1,10],[3,20],[5,30]]);expect(stats.means).toEqual([3,20]);const n=neighbors([2,12],[{id:'one',vector:[1,10]},{id:'far',vector:[5,30]}]);expect(n[0]?.id).toBe('one');});
