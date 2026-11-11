import {auditValidationEvidence,VALIDATION_MODES,type ValidationRow} from './validation-evidence.js';
/** Research comparator only: conditional-mean scoring, never a probability or active policy. */
export function compareValidationLoss(rows:readonly ValidationRow[],window:{validationStart:number;testStart:number}){
 const audit=auditValidationEvidence(rows,window),scores=Object.fromEntries(VALIDATION_MODES.map(mode=>{const s=audit.full.metrics[mode];return [mode,{knownLabels:s.knownLabels,coverage:s.coverage,mae:s.mae,mse:s.knownLabels?s.squaredError/s.knownLabels:null}];})) as Record<typeof VALIDATION_MODES[number],{knownLabels:number;coverage:number|null;mae:number|null;mse:number|null}>;
 let selected:typeof VALIDATION_MODES[number]='zero',best=scores.zero.mse??Infinity;
 const enough=scores.zero.knownLabels>=40;
 if(enough)for(const mode of VALIDATION_MODES.slice(1)){const s=scores[mode];if((s.coverage??0)>=.95&&s.mse!==null&&s.mse<best-1e-12){selected=mode;best=s.mse;}}
 return {version:'validation-mean-loss-v1',selected,originalSelected:audit.full.selected,scores,distinctValidationClocks:audit.distinctClocks,reason:enough?'minimum-validation-MSE-with-existing-coverage-and-conservative-ties':'insufficient-known-validation-rows',independentSamples:null,estimatedWinProbability:null,activePolicyChanged:false};
}
