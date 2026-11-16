import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

/**
 * The 2024 validation gate is separate from the 2025+ holdout.
 * This module never reads or imports candles. It only validates immutable
 * preregistration and can reserve a single attempt with create-only semantics.
 */
export const H025_VALIDATION_PERIOD=Object.freeze({
 warmupFrom:'2023-01-01',from:'2024-01-01',toExclusive:'2025-01-01',
 profiles:['basis','vorsichtig','normal','aggressiv'] as const,
 outcome:'one-attempt-only, failures are consumed' as const
});

export type Validation2024Plan={
 version:1;
 candidate:'v5'|'v5.1';
 developmentResultSha256:string;
 preregisteredAt:string;
 criteria:{maxDrawdownBelow:number;calmarAboveBenchmark:'BTC/ETH 50/50 halten'};
 profiles:['basis','vorsichtig','normal','aggressiv'];
 period:{from:'2024-01-01';toExclusive:'2025-01-01'};
};

/** Refuse guessed candidates, missing 2020–23 evidence, changed split, or post hoc criteria. */
export function validateValidation2024Plan(plan:unknown,split:unknown):Validation2024Plan{
 const p=plan as Partial<Validation2024Plan>|null;
 const s=split as {version?:number;immutable?:boolean;
  development?:{start?:string;end?:string};validation?:{start?:string;end?:string};
  holdout?:{start?:string}}|null;
 if(!s||s.version!==1||s.immutable!==true||
    s.development?.start!=='2020-01-01'||s.development?.end!=='2023-12-31'||
    s.validation?.start!=='2024-01-01'||s.validation?.end!=='2024-12-31'||
    s.holdout?.start!=='2025-01-01')
  throw Error('Immutable 2024 data split changed: validation denied');
 if(!p||p.version!==1||(p.candidate!=='v5'&&p.candidate!=='v5.1')||
    !/^[a-f0-9]{64}$/.test(p.developmentResultSha256??'')||
    !/^2026-[0-9]{2}-[0-9]{2}T/.test(p.preregisteredAt??'')||
    !Number.isFinite(Date.parse(p.preregisteredAt??''))||
    p.criteria?.maxDrawdownBelow!==.30||
    p.criteria?.calmarAboveBenchmark!=='BTC/ETH 50/50 halten'||
    JSON.stringify(p.profiles)!==JSON.stringify(H025_VALIDATION_PERIOD.profiles)||
    p.period?.from!==H025_VALIDATION_PERIOD.from||
    p.period?.toExclusive!==H025_VALIDATION_PERIOD.toExclusive)
  throw Error('2024 candidate, prior development result, four profiles and frozen criteria must be preregistered');
 // Unknown extra fields must not silently authorize a second candidate or a holdout interval.
 if(Object.keys(p).sort().join(',')!==
   ['version','candidate','developmentResultSha256','preregisteredAt','criteria','profiles','period'].sort().join(','))
  throw Error('Unexpected 2024 preregistration fields');
 return p as Validation2024Plan;
}
export function validation2024PlanHash(plan:Validation2024Plan):string{
 return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}
export type Validation2024Claim={version:1;planHash:string;candidate:string;
 claimedAt:string;status:'consumed';scope:'calendar-2024-only'};

/**
 * Local create-only guard: file mode wx atomically rejects a second attempt.
 * In GitHub Actions, the repository-level reservation MUST additionally be
 * atomically created via GitHub Contents API (no sha) BEFORE the import job.
 * Runner-local workspace files alone are not cross-run protection.
 */
export function claimValidation2024Once(path:string,plan:Validation2024Plan,now:Date=new Date()):Validation2024Claim{
 const record:Validation2024Claim={
  version:1,planHash:validation2024PlanHash(plan),candidate:plan.candidate,
  claimedAt:now.toISOString(),status:'consumed',scope:'calendar-2024-only'
 };
 mkdirSync(dirname(path),{recursive:true});
 writeFileSync(path,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 return record;
}
export function loadValidation2024Plan(path:string,splitPath:string):Validation2024Plan{
 return validateValidation2024Plan(
  JSON.parse(readFileSync(path,'utf8')),JSON.parse(readFileSync(splitPath,'utf8')));
}
