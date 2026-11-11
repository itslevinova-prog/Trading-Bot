import {createHash} from 'node:crypto';import {existsSync,lstatSync,realpathSync,readdirSync,readFileSync,mkdirSync,copyFileSync,symlinkSync} from 'node:fs';import {resolve,relative,dirname,join,isAbsolute} from 'node:path';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function inside(root,path){const rel=relative(resolve(root),resolve(path));if(rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(rel))throw Error('Outside candidate/source root');return resolve(path);}
export function files(root){const result=[];function walk(folder){for(const name of readdirSync(folder).sort()){if(name==='node_modules'||name==='node_gyp_bins')continue;const path=join(folder,name),stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('Unexpected package symlink: '+relative(root,path));if(stat.isDirectory())walk(path);else if(stat.isFile())result.push({path:relative(root,path).replaceAll('\\','/'),sha256:hash(readFileSync(path))});}}walk(root);return result;}
function copyTree(source,target){mkdirSync(target,{recursive:true});for(const entry of files(source)){const to=inside(target,resolve(target,entry.path));mkdirSync(dirname(to),{recursive:true});copyFileSync(resolve(source,entry.path),to);if(hash(readFileSync(to))!==entry.sha256)throw Error('Package changed while copying');}}
function dependency(source,name){let current=source;while(true){const path=join(current,'node_modules',name);if(existsSync(path))return realpathSync(path);const parent=dirname(current);if(parent===current)return null;current=parent;}}
/** Copy installed production dependency closure. No installer, network, scripts or shared mutable workspace links. */
export function freezeDependencies(sourceRoot,targetRoot){
 sourceRoot=realpathSync(sourceRoot);targetRoot=resolve(targetRoot);const records=new Map(),shared=realpathSync(join(sourceRoot,'packages/shared'));
 function visit(source,kind='package'){
  inside(sourceRoot,source);if(records.has(source))return records.get(source);
  const packageBytes=readFileSync(join(source,'package.json')),pkg=JSON.parse(packageBytes.toString('utf8'));const local=source===shared;
  const target=local?join(targetRoot,'packages/shared'):kind==='server'?join(targetRoot,'apps/server'):join(targetRoot,'.candidate-deps',hash(relative(sourceRoot,source)).slice(0,24));
  if(!local&&kind!=='server')copyTree(source,target);
  if(hash(readFileSync(join(target,'package.json')))!==hash(packageBytes))throw Error('Package manifest changed during freeze');
  const record={name:pkg.name,version:pkg.version??null,path:relative(targetRoot,target).replaceAll('\\','/'),dependencies:[],missingOptional:[]};records.set(source,record);
  const required={...pkg.peerDependencies,...pkg.dependencies,...pkg.optionalDependencies};
  for(const name of Object.keys(required).sort()){
   const found=dependency(source,name),optional=Object.hasOwn(pkg.optionalDependencies??{},name)||pkg.peerDependenciesMeta?.[name]?.optional===true;
   if(!found){if(optional){record.missingOptional.push(name);continue;}throw Error('Missing installed runtime dependency '+pkg.name+': '+name);}
   const dep=visit(found),link=inside(targetRoot,join(target,'node_modules',name)),to=inside(targetRoot,join(targetRoot,dep.path));mkdirSync(dirname(link),{recursive:true});symlinkSync(to,link,process.platform==='win32'?'junction':'dir');record.dependencies.push({name,path:dep.path});
  }
  record.files=files(target);record.filesHash=hash(JSON.stringify(record.files));return record;
 }
 visit(realpathSync(join(sourceRoot,'apps/server')),'server');return [...records.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
export function verifyDependencies(root,records){const canonicalRoot=realpathSync(root);for(const record of records){const folder=inside(root,join(root,record.path));inside(canonicalRoot,realpathSync(folder));if(hash(JSON.stringify(files(folder)))!==record.filesHash)throw Error('Candidate dependency files changed: '+record.name);for(const dep of record.dependencies){const link=inside(root,join(folder,'node_modules',dep.name)),expected=inside(root,join(root,dep.path));inside(canonicalRoot,realpathSync(link));if(realpathSync(link)!==realpathSync(expected))throw Error('Candidate dependency link changed: '+dep.name);}}return true;}
