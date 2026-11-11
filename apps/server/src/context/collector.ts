import {alignedPortfolioCovariance,type CovariancePanel} from './portfolio-covariance.js';
import {needsCovariancePolicy} from '../strategy/mock-policy.js';
import {and,desc,eq,lte,sql} from 'drizzle-orm';
import {db} from '../db.js';import {candles} from '../schema.js';import type {MarketFeed} from '../market/types.js';import {config} from '../config.js';import {paperMarketContext} from './paper-market-context.js';

export function collectMarketContext(market:MarketFeed,now=Date.now()):ReturnType<typeof paperMarketContext>&{covariance?:CovariancePanel}{
 const symbols=new Set([...market.tickers.keys(),...market.features.keys()]);
 const inputs=[...symbols].map(pair=>{const read=(interval:number,limit:number)=>db.select().from(candles).where(and(eq(candles.pair,pair),eq(candles.interval,interval),lte(candles.ts,now-interval*60000))).orderBy(desc(candles.ts)).limit(limit).all().reverse();const coverage=db.select({closedBars:sql<number>`count(*)`,firstAt:sql<number|null>`min(ts)`,lastAt:sql<number|null>`max(ts)`}).from(candles).where(and(eq(candles.pair,pair),eq(candles.interval,15),lte(candles.ts,now-900000))).get();return {pair,historyRepair:{m15:market.historyStatus?.get(`${pair}:15`)??null,h1:market.historyStatus?.get(`${pair}:60`)??null},candles:read(15,9000),hourly:read(60,2300),coverage,ticker:market.tickers.get(pair),book:market.books.get(pair),feature:market.features.get(pair)};});
 const context=paperMarketContext(inputs,market.venue,config.QUOTE_CURRENCY,now);
 return config.PAPER_EXPERIMENT_MODE==='mock'&&needsCovariancePolicy(config.PAPER_MOCK_POLICY)&&inputs.length>0?{...context,covariance:alignedPortfolioCovariance(inputs,now)}:context;
}
