import type {DecisionProvider} from '@paper/shared';
import {entrySupportReplayStudy} from './entry-support-replay.js';
import type {PortfolioOptions,ReplayStudy} from './portfolio.js';import type {MockReplayAssumptions} from './mock-replay-context.js';
import {closedGainWitness} from '../strategy/gain-protection-paper.js';
export function gainProtectionReplayStudy(options:PortfolioOptions,assumptions:MockReplayAssumptions,provider:DecisionProvider,scope:string){
 const capture=entrySupportReplayStudy(options,assumptions,provider,scope),base=capture.study;
 const study:ReplayStudy={...base,enrich:(context,markets)=>{const c=base.enrich(context,markets),witnesses=c.positions.map(p=>{const position=p as Record<string,any>,m=markets.find(m=>m.pair===position.pair);return closedGainWitness(c,position,m?.candles??[]);});return {...c,portfolioEvidence:{...(c.portfolioEvidence as Record<string,unknown>),gainProtection:witnesses}};}};return {...capture,study};
}
