import {validateValidation2024Plan,validation2024PlanHash,type Validation2024Plan,type Validation2024Claim}
 from './validation-2024-guard.js';

/**
 * Actions runners do not share local files. Reserve the 2024 attempt via the
 * repository contents API with a CREATE-only PUT (no sha field). A second call
 * fails with 409/422 and must never proceed to import any 2024 market data.
 *
 * Use only from the owner-approved, separately gated stage-2 workflow with
 * contents:write and a serialized concurrency group. Never retry a failed
 * reservation by updating/deleting the marker.
 */
export async function reserveValidation2024InRepository(args:{
 owner:string;repo:string;token:string;commitSha:string;plan:Validation2024Plan;split:unknown;
 now?:Date;request?:typeof fetch;
}):Promise<Validation2024Claim>{
 const {owner,repo,token,commitSha}=args;
 const plan=validateValidation2024Plan(args.plan,args.split);
 if(!/^[A-Za-z0-9_.-]+$/.test(owner)||!/^[A-Za-z0-9_.-]+$/.test(repo)||
    !token||!/^[a-f0-9]{40}$/.test(commitSha))
  throw Error('Invalid repository credentials or immutable source commit for 2024 claim');
 const record:Validation2024Claim={
  version:1,planHash:validation2024PlanHash(plan),candidate:plan.candidate,
  claimedAt:(args.now??new Date()).toISOString(),
  status:'consumed',scope:'calendar-2024-only'
 };
 const path='docs/research/validation-2024-consumed.json';
 const content=Buffer.from(JSON.stringify({...record,commitSha},null,2)+'\n').toString('base64');
 const payload={message:'chore: consume single 2024 validation attempt (#44)',
  content,branch:'main'};
 const request=args.request??fetch;
 const result=await request('https://api.github.com/repos/'+owner+'/'+repo+'/contents/'+path,{
  method:'PUT',headers:{'Accept':'application/vnd.github+json',
   'Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',
   'Content-Type':'application/json'},
  body:JSON.stringify(payload)
 });
 if(result.status===409||result.status===422)
  throw Error('2024 validation already consumed or reservation conflicted; no second attempt');
 if(result.status!==201)
  throw Error('2024 validation reservation denied: HTTP '+result.status);
 return record;
}
