import {test,expect,vi} from 'vitest';
import {createMockProvider,needsCovariancePolicy} from '../src/strategy/mock-policy.js';
import {MockAiProvider} from '../src/strategy/providers.js';import {CovariancePaperProvider} from '../src/strategy/covariance-paper.js';import {StructureExitPaperProvider} from '../src/strategy/structure-exit-paper.js';
import {Env} from '../src/config.js';import {sanitisedTradingConfig} from '../src/provenance/build.js';
test('only explicitly registered simulated provider variants are selected, never a real provider fallback',()=>{
 const fetch=vi.spyOn(globalThis,'fetch');try{expect(createMockProvider()).toBeInstanceOf(MockAiProvider);expect(createMockProvider('covariance-v1')).toBeInstanceOf(CovariancePaperProvider);expect(createMockProvider('structure-exit-v1')).toBeInstanceOf(StructureExitPaperProvider);expect(()=>createMockProvider('unregistered')).toThrow('Unknown');expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
});
test('covariance is required for new variants and absent for legacy/default configuration',()=>{expect(needsCovariancePolicy('covariance-v1')).toBe(true);expect(needsCovariancePolicy('structure-exit-v1')).toBe(true);expect(needsCovariancePolicy('trend-v2')).toBe(false);expect(needsCovariancePolicy(undefined)).toBe(false);});
const profile={PAPER_EXPERIMENT_MODE:'mock',AI_PROVIDER:'mock',DATABASE_PATH:'./data/mock-experiment.db',PAPER_FIXED_PAIRS:'["BTC/EUR","ETH/EUR"]',TOP_N_PAIRS:2,PAPER_MOCK_POLICY:'structure-exit-v1'};
test('new model variant is traceable in sanitized configuration and requires fixed isolated mock profile',()=>{
 const c=Env.parse(profile);expect(sanitisedTradingConfig(c).PAPER_MOCK_POLICY).toBe('structure-exit-v1');expect(Env.safeParse({...profile,PAPER_FIXED_PAIRS:''}).success).toBe(false);expect(Env.safeParse({...profile,PAPER_EXPERIMENT_MODE:'off'}).success).toBe(false);expect(Env.safeParse({...profile,AI_PROVIDER:'openai-compatible'}).success).toBe(false);expect(Env.parse({}).PAPER_MOCK_POLICY).toBe('trend-v2');
});
