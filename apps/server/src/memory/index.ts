import type {FeatureSnapshot} from '@paper/shared';
import {sqlite} from '../db.js';
import {PaperMemoryStore} from './store.js';
export {vector,statistics,neighbors} from './math.js';
const memory = new PaperMemoryStore(sqlite);
export function saveMemory(decisionId:string,accountId:string,features:FeatureSnapshot[],actions:{pair?:string;type:string}[]) {memory.save(decisionId,accountId,features,actions,Date.now());}
export function recall(pair:string,f:FeatureSnapshot,asOf:number,accountId?:string) {return memory.recall(pair,f,asOf,accountId);}
export function backfillMemory(asOf=Date.now()) {return memory.backfill(asOf);}
