/** Native intent phases describe durable local knowledge, not exchange guarantees. */
export const EXIT_PHASES=['exit_prepared','exit_cancel_pending','exit_cancel_unknown','exit_canceled_verified','exit_order_pending','exit_order_unknown','exit_remaining_verified','exit_reprotect_pending','exit_reprotect_unknown','exit_closed','exit_protected','exit_unchanged','exit_halted_unprotected'] as const;
export type ExitPhase=typeof EXIT_PHASES[number];
const entry:Record<string,readonly string[]>={pending:['unknown','accepted','not_filled','rejected','closed'],unknown:['unknown','accepted','not_filled','rejected','closed'],accepted:['accepted','unknown','closed','not_filled'],not_filled:[],closed:[],rejected:[]};
const exit:Record<ExitPhase,readonly ExitPhase[]>={
 exit_prepared:['exit_cancel_pending','exit_unchanged','exit_closed','exit_halted_unprotected'],
 exit_cancel_pending:['exit_cancel_unknown','exit_canceled_verified','exit_unchanged','exit_closed','exit_halted_unprotected'],
 exit_cancel_unknown:['exit_cancel_unknown','exit_canceled_verified','exit_unchanged','exit_closed','exit_halted_unprotected'],
 exit_canceled_verified:['exit_order_pending','exit_remaining_verified','exit_closed','exit_halted_unprotected'],
 exit_order_pending:['exit_order_unknown','exit_remaining_verified','exit_closed','exit_halted_unprotected'],
 exit_order_unknown:['exit_order_unknown','exit_remaining_verified','exit_closed','exit_halted_unprotected'],
 exit_remaining_verified:['exit_reprotect_pending','exit_closed','exit_halted_unprotected'],
 exit_reprotect_pending:['exit_reprotect_unknown','exit_protected','exit_closed','exit_halted_unprotected'],
 exit_reprotect_unknown:['exit_reprotect_unknown','exit_protected','exit_closed','exit_halted_unprotected'],
 exit_halted_unprotected:['exit_halted_unprotected','exit_remaining_verified','exit_closed','exit_protected'],
 exit_closed:[],exit_protected:[],exit_unchanged:[]
};
export function isUnresolvedIntent(intent:{side:string;state:string}){
 return intent.side==='buy'?!['accepted','not_filled','closed','rejected'].includes(intent.state):intent.side==='sell'?!['exit_closed','exit_protected','exit_unchanged'].includes(intent.state):true;
}
export function assertInitialIntent(side:string,state:string){if(!(side==='buy'&&state==='pending'||side==='sell'&&state==='exit_prepared'))throw Error('Invalid initial native intent phase');}
export function assertIntentTransition(side:string,from:string,to:string){const transitions=side==='buy'?entry:side==='sell'?exit:null;if(!transitions||!Object.hasOwn(transitions,from)||!transitions[from as keyof typeof transitions]?.includes(to as never))throw Error('Invalid native intent transition');}
