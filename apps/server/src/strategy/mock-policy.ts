import type {DecisionProvider} from '@paper/shared';
import {MockAiProvider} from './providers.js';
import {CovariancePaperProvider} from './covariance-paper.js';
import {StructureExitPaperProvider} from './structure-exit-paper.js';
export const needsCovariancePolicy=(policy:unknown)=>policy==='covariance-v1'||policy==='structure-exit-v1';
export function createMockProvider(policy:string='trend-v2'):DecisionProvider{
 switch(policy){case 'trend-v2':return new MockAiProvider();case 'covariance-v1':return new CovariancePaperProvider();case 'structure-exit-v1':return new StructureExitPaperProvider();default:throw Error('Unknown simulated Paper policy');}
}
