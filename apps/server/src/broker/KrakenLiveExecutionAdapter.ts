import type {BrokerOrder} from '@paper/shared';
import type {ExecutionAdapter} from './PaperExecutionAdapter.js';
/** Deliberately inert. No authenticated Kraken endpoints exist in this codebase. */
export class KrakenLiveExecutionAdapter implements ExecutionAdapter{
 async placeMarketOrder(_order:BrokerOrder):Promise<never>{throw new Error('Live-Handel ist in dieser Version nicht implementiert');}
 getBalances(_id:string):never{throw new Error('Live-Handel ist in dieser Version nicht implementiert');}
}
