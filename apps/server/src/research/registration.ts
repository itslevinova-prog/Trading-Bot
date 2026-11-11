import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
export function registerForwardVersion(root:string,descriptor:{strategyHash:string;sourceFiles:string[];options:unknown;universe:string[]},now=Date.now()){
 if(!/^[a-f0-9]{64}$/.test(descriptor.strategyHash))throw Error('Invalid strategy fingerprint');
 const relative=`docs/forward-registrations/${descriptor.strategyHash}.json`,folder=resolve(root,'docs/forward-registrations'),file=resolve(root,relative);mkdirSync(folder,{recursive:true});
 if(!existsSync(file)){
  const document={registeredAt:new Date(now).toISOString(),firstForwardDecisionAt:new Date(Math.ceil((now+10*60000)/900000)*900000+5000).toISOString(),...descriptor,deploymentVerified:false,historicalDataAlreadyInspected:true,profitabilityEstablished:false,method:'Immutable registration per source/config/universe fingerprint. Source/config/universe changes create a new registration, never a retroactive cutoff. Forward evidence additionally requires deployment verification and decisions tagged with this version.'};
  writeFileSync(file,JSON.stringify(document,null,2),{flag:'wx'});
 }
 const previous=JSON.parse(readFileSync(file,'utf8'));
 if(previous.strategyHash!==descriptor.strategyHash)throw Error('Forward registration identity mismatch');
 return relative;
}
