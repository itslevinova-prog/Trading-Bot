import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',env:{DATABASE_PATH:'./data/test-paper.db',TAKER_FEE_RATE:'0.008',MAX_ENTRY_SPREAD_BPS:'500',MAX_ENTRY_SLIPPAGE_BPS:'500',CONTEXT_EXTERNAL_ENABLED:'false',SIMULATED_LATENCY_MS_MIN:'0',SIMULATED_LATENCY_MS_MAX:'0'},maxWorkers:1,fileParallelism:false}});
