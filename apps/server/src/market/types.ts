import type {FeatureSnapshot,MarketTicker,OrderBook} from '@paper/shared';

/** Trading, research and prompts consume this contract rather than a venue client. */
export interface MarketFeed {
 readonly historyStatus?:ReadonlyMap<string,unknown>;
 readonly venue:'kraken'|'binance';
 readonly tickers:Map<string,MarketTicker>;
 readonly books:Map<string,OrderBook>;
 readonly features:Map<string,FeatureSnapshot>;
 connected:boolean;
 start():Promise<void>;
 stop():void;
 calculate(pair:string):void;
}
