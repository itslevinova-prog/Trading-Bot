import {summarizePublicActivity} from './executed-activity.js';
/** Required availability/freshness gate for decision-time research consumers. */
export function publicActivityAtDecision(pair:string,raw:unknown,closedAt:number,capturedAt:number,asOf:number){
 const deny=(reason:string)=>({available:false as const,reason,summary:null});
 if(!Number.isSafeInteger(asOf)||asOf<0||!Number.isSafeInteger(capturedAt)||capturedAt<0||!Number.isSafeInteger(closedAt)||closedAt<0)return deny('invalid-decision-or-source-clock');
 if(capturedAt>asOf)return deny('not-yet-captured-at-decision');
 if(closedAt!==Math.floor(asOf/900000)*900000)return deny('source-window-not-current-at-decision');
 const summary=summarizePublicActivity(pair,raw,closedAt,capturedAt);
 if(!summary.sourceComplete||Object.values(summary.windows).some(w=>!w.complete))return deny('source-or-aggregate-unavailable');
 return {available:true as const,reason:null,summary};
}
