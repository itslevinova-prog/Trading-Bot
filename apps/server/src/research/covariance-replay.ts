import {alignedPortfolioCovariance} from '../context/portfolio-covariance.js';
import {mockReplayStudy,type MockReplayAssumptions} from './mock-replay-context.js';
import type {PortfolioOptions,ReplayStudy} from './portfolio.js';
export function covarianceReplayStudy(options:PortfolioOptions,assumptions:MockReplayAssumptions):ReplayStudy{
 const base=mockReplayStudy(options,assumptions);
 return {...base,enrich:(context,markets)=>{const c=base.enrich(context,markets);return {...c,portfolioEvidence:{...(c.portfolioEvidence&&typeof c.portfolioEvidence==='object'?c.portfolioEvidence:{}),covariance:alignedPortfolioCovariance(markets,Date.parse(c.timeUTC))}};}};
}
