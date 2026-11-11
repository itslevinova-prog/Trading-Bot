import {parseAiAnswer,type DecisionContext,type DecisionProvider,type DecisionResult} from '@paper/shared';
import {SYSTEM_PROMPT,packContext} from './prompt.js';import {requestJson} from './transport.js';import {observeLocalModel,ollamaOrigin,sha256,type LocalModelIdentity} from './model-identity.js';
export type PreparedModelInput={context:DecisionContext;systemPrompt:string;userPrompt:string;evidence:ModelEvidence};
export type ModelEvidence={phase:'blocked'|'prepared'|'sent'|'validated'|'rejected';mode:string;modelArtifactVerified:false;expectedFingerprint?:string;inferenceAttempted:boolean;preSendHookCompleted:boolean;inputIdentity?:LocalModelIdentity;postIdentity?:LocalModelIdentity;requestBodyHash?:string;providerResponseJsonHash?:string;assistantContentHash?:string;systemPromptHash?:string;userPromptHash?:string;inputChars?:number;inputBytes?:number;contextTokens?:number;promptEvalCount?:number;outputEvalCount?:number;observedFingerprintMatched?:boolean;startedAt:number;finishedAt?:number;budgetMethod?:string};
export type ModelOptions={enabled:boolean;baseUrl:string;model:string;apiKey:string;allowRemote:boolean;maxChars:number;maxOutputTokens:number;mode:'ollama-local'|'compatible-unverified';expectedFingerprint?:string;contextTokens?:number;onPrepared?:(input:PreparedModelInput)=>void|Promise<void>};
export function modelEndpoint(options:ModelOptions){
 if(options.enabled!==true)throw Error('KI-Aufrufe deaktiviert');if(typeof options.allowRemote!=='boolean')throw Error('Ungültige Remote-Freigabe');if(!options.model.trim())throw Error('Kein Modell konfiguriert');let u:URL;try{u=new URL(options.baseUrl);}catch{throw Error('Ungültige KI-Basis-URL');}const local=['127.0.0.1','[::1]','localhost'].includes(u.hostname);
 if(u.username||u.password||u.search||u.hash)throw Error('Ungültige KI-Basis-URL');if(!local&&!options.allowRemote)throw Error('Kostenlose Voreinstellung erlaubt ausschliesslich ein lokales Modell');if(!['http:','https:'].includes(u.protocol)||!local&&u.protocol!=='https:')throw Error('Remote-KI benötigt HTTPS');
 if(options.mode==='ollama-local'){if(options.allowRemote)throw Error('Lokaler Modellmodus erlaubt keinen Remote-Schalter');u=ollamaOrigin(options.baseUrl,options.model);u.pathname='/api/chat';}
 else if(options.mode==='compatible-unverified'){if(!options.allowRemote)throw Error('Ungeprüftes Routing benötigt ausdrückliche Remote-Freigabe');u.pathname=u.pathname.replace(/\/$/,'')+'/chat/completions';}
 else throw Error('Unbekannter Modellmodus');return u;
}
export class CompatibleDecisionProvider implements DecisionProvider{
 private evidence:ModelEvidence|null=null;private busy=false;
 constructor(private options:ModelOptions,private request:typeof fetch=fetch){}
 getEvidence(){return this.evidence?JSON.parse(JSON.stringify(this.evidence)) as ModelEvidence:null;}
 async decide(context:DecisionContext):Promise<DecisionResult>{
  if(this.busy)throw Error('Modellanfrage bereits aktiv');this.busy=true;this.evidence={phase:'blocked',mode:this.options.mode,modelArtifactVerified:false,inferenceAttempted:false,preSendHookCompleted:false,startedAt:Date.now()};
  try{
   const url=modelEndpoint(this.options);if(!Number.isSafeInteger(this.options.maxChars)||this.options.maxChars<1000||this.options.maxChars>500000||!Number.isSafeInteger(this.options.maxOutputTokens)||this.options.maxOutputTokens<1||this.options.maxOutputTokens>4000)throw Error('Ungültige Modellgrenzen');if(typeof this.options.onPrepared!=='function')throw Error('Dauerhaftes Eingangsprotokoll vor Inferenz fehlt');const snapshot=JSON.parse(JSON.stringify(context)) as DecisionContext;let before:LocalModelIdentity|undefined;
   if(this.options.mode==='ollama-local'){
    if(!/^[0-9a-f]{64}$/.test(this.options.expectedFingerprint??''))throw Error('Lokaler Modell-Fingerprint fehlt; keine Inferenz');
    if(!Number.isSafeInteger(this.options.contextTokens)||this.options.contextTokens!<2048||this.options.contextTokens!>262144)throw Error('Ungültiges Modell-Kontextfenster');
    this.evidence.expectedFingerprint=this.options.expectedFingerprint;before=await observeLocalModel(this.options.baseUrl,this.options.model,this.request);this.evidence.inputIdentity=before;
    if(before.fingerprint!==this.options.expectedFingerprint)throw Error('Lokale Modellidentität stimmt nicht mit dem Pin überein');
    if(this.options.contextTokens!>before.advertisedContextTokens)throw Error('Konfiguriertes Kontextfenster überschreitet Modellkapazität');snapshot.modelIdentity=before;
   }
   let budget=this.options.maxChars,packed=packContext(snapshot,budget);const byteBudget=before?this.options.contextTokens!-this.options.maxOutputTokens-before.templateBytes-4096:Infinity;
   if(before){for(let n=0;n<8&&Buffer.byteLength(SYSTEM_PROMPT+packed.user,'utf8')>byteBudget;n++){const over=Buffer.byteLength(SYSTEM_PROMPT+packed.user,'utf8')-byteBudget;budget-=Math.max(256,over);if(budget<1000)throw Error('Kontextfenster reicht für Pflichtdaten nicht');packed=packContext(snapshot,budget);}if(Buffer.byteLength(SYSTEM_PROMPT+packed.user,'utf8')>byteBudget)throw Error('Kontextfenster reicht für Pflichtdaten nicht');}
   const messages=[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:packed.user}];
   const payload=before?{model:this.options.model,stream:false,format:'json',think:false,truncate:false,shift:false,options:{temperature:0,seed:0,num_ctx:this.options.contextTokens,num_predict:this.options.maxOutputTokens},messages}:{model:this.options.model,temperature:0,max_tokens:this.options.maxOutputTokens,stream:false,response_format:{type:'json_object'},messages};
   const body=JSON.stringify(payload);Object.assign(this.evidence,{phase:'prepared',requestBodyHash:sha256(body),systemPromptHash:sha256(SYSTEM_PROMPT),userPromptHash:sha256(packed.user),inputChars:packed.chars,inputBytes:Buffer.byteLength(SYSTEM_PROMPT+packed.user,'utf8'),contextTokens:this.options.contextTokens,budgetMethod:before?'Client UTF-8 bytes plus server template/system bytes, output allowance and4096 framing reserve. Conservative estimate, not an exact tokenizer proof. truncate=false and shift=false requested.':'Provider context/tokenizer unverified'});
   await this.options.onPrepared?.({context:JSON.parse(JSON.stringify(snapshot)) as DecisionContext,systemPrompt:SYSTEM_PROMPT,userPrompt:packed.user,evidence:this.getEvidence()!});
   this.evidence.preSendHookCompleted=this.options.onPrepared!==undefined;this.evidence.inferenceAttempted=true;this.evidence.phase='sent';const response=await requestJson(this.request,url,{method:'POST',headers:{'Content-Type':'application/json',...(!before&&this.options.apiKey?{Authorization:`Bearer ${this.options.apiKey}`}:{})},body});
   this.evidence.providerResponseJsonHash=sha256(JSON.stringify(response));let content:unknown;
   if(before){
    if(response.remote_host||response.remote_model||response.model!==this.options.model||response.done!==true||response.done_reason!=='stop'||response.message?.role!=='assistant'||response.message?.tool_calls?.length)throw Error('Unvollständige oder nicht lokale Modellantwort');
    this.evidence.promptEvalCount=Number.isSafeInteger(response.prompt_eval_count)&&response.prompt_eval_count>=0?response.prompt_eval_count:undefined;this.evidence.outputEvalCount=Number.isSafeInteger(response.eval_count)&&response.eval_count>=0?response.eval_count:undefined;
    if(this.evidence.promptEvalCount!==undefined&&this.evidence.promptEvalCount+this.options.maxOutputTokens>this.options.contextTokens!)throw Error('Gemeldete Tokenbelegung überschreitet das Kontextfenster');
    const after=await observeLocalModel(this.options.baseUrl,this.options.model,this.request);this.evidence.postIdentity=after;
    if(after.fingerprint!==before.fingerprint)throw Error('Modellidentität hat sich während der Inferenz geändert');this.evidence.observedFingerprintMatched=true;content=response.message?.content;
   }else{const choice=response.choices?.[0];if(!choice||choice.finish_reason!=='stop'||typeof choice.message?.content!=='string'||choice.message?.tool_calls?.length)throw Error('Unvollständige oder nicht unterstützte KI-Antwort');content=choice.message.content;}
   if(typeof content!=='string')throw Error('Leere Modellantwort');this.evidence.assistantContentHash=sha256(content);const result=parseAiAnswer(content,new Set(snapshot.features.map(f=>f.pair)));if(!result.valid||result.errors.length)throw Error('KI-JSON enthält ungültige Aktionen; gesamter Auftrag verworfen');this.evidence.phase='validated';return {marketView:result.marketView,actions:result.actions};
  }catch(error){this.evidence.phase='rejected';throw error;}finally{this.evidence.finishedAt=Date.now();this.busy=false;}
 }
}
