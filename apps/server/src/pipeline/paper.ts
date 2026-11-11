import {loadRegistry,versionOf,readStage,computeCodeHash} from './registry.js';

/**
 * Call this before opening a new paper account. No broker is started here.
 * Explicit benchmark accounts are not pipeline candidates.
 */
export function requirePaperAdmission(root:string,strategyId:string,version:string):
 {kind:'benchmark'|'pipeline';strategyId:string;version:string;codeHash:string} {
 const {strategy,entry}=versionOf(loadRegistry(root),strategyId,version);
 if(computeCodeHash(root,strategyId)!==entry.codeHash)throw Error('Paper version code hash changed; register a new version');
 if(strategy.benchmark)return {kind:'benchmark',strategyId,version,codeHash:entry.codeHash};
 const stage3=readStage(root,strategyId,version,3);
 if(!stage3||stage3.status!=='passed'||stage3.codeHash!==entry.codeHash||
  entry.stage<4||entry.status==='failed')throw Error('Paper requires a registered version that passed stage 3');
 return {kind:'pipeline',strategyId,version,codeHash:entry.codeHash};
}

/**
 * The main paper server checks this on every proposed entry, including after
 * simulated latency. Only the built-in hold account is a named benchmark.
 * Missing/mismatched bindings fail closed, never fall back to "rules".
 */
export function requireAccountPaperAdmission(
 root:string,account:{id:string;strategy:string},env:NodeJS.ProcessEnv=process.env,
):{kind:'benchmark'|'pipeline';strategyId:string;version:string;codeHash:string} {
 if((account.id==='hold'&&account.strategy==='hold')||
    (account.id==='dca'&&account.strategy==='dca')) {
  const benchmark=loadRegistry(root).strategies.find(s=>s.id===account.id&&s.benchmark);
  if(!benchmark)throw Error('Paper benchmark is not explicitly registered');
  return {kind:'benchmark',strategyId:account.id,version:'benchmark',codeHash:''};
 }
 const key=account.strategy==='rules'?'PAPER_RULES_PIPELINE_VERSION':
  account.strategy==='ai'?'PAPER_AI_PIPELINE_VERSION':null;
 if(!key||!env[key])throw Error('No registered pipeline version configured for paper account '+account.id);
 return requirePaperAdmission(root,account.strategy,env[key]!);
}
