import type {DecisionProvider,DecisionContext,DecisionResult} from '@paper/shared';
export class ClaudeDecisionProvider implements DecisionProvider{async decide(_context:DecisionContext):Promise<DecisionResult>{throw new Error('Noch nicht implementiert');}}
