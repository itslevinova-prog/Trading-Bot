export type HealthSignal = {connected:boolean;checkedAt:number;pairs:number;freshBooks:number;protectiveExitFailures:number};
export type RiskSignal = {accounts:{accountId:string;latched:boolean;current:unknown|null}[]};
export type Light = {color:'red'|'yellow'|'green';title:string;reason:string};

/** Only observable safety facts may produce a red light; absent evidence is never green. */
export function getSimpleStatus(input:{
 serverError:string;connected:boolean;health:HealthSignal|null;risk:RiskSignal|null;now:number
}):Light {
 if(input.serverError)return {color:'red',title:'Verbindung zum Programm fehlt',reason:'Der Server antwortet nicht. Der Zustand des Bots ist unbekannt.'};
 const {health,risk,now}=input;
 if(health?.protectiveExitFailures && health.protectiveExitFailures>0)
  return {color:'red',title:'Schutzverkauf benötigt Aufmerksamkeit',reason:'Mindestens ein Schutzverkauf ist laut Protokoll fehlgeschlagen.'};
 if(risk?.accounts.some(a=>a.latched))
  return {color:'red',title:'Handel durch Sicherheitsstopp blockiert',reason:'Ein Konto meldet einen aktiven Sicherheitsstopp.'};
 if(!health||!risk||!Number.isFinite(health.checkedAt)||now-health.checkedAt>30_000||now<health.checkedAt-5_000)
  return {color:'yellow',title:'Zustand nicht vollständig prüfbar',reason:'Aktuelle Sicherheits- oder Verbindungsdaten fehlen.'};
 if(!input.connected||!health.connected)
  return {color:'yellow',title:'Börsenverbindung prüfen',reason:'Die Verbindung zu öffentlichen Marktdaten ist unterbrochen.'};
 if(health.pairs===0||health.freshBooks<health.pairs)
  return {color:'yellow',title:'Marktdaten prüfen',reason:'Nicht alle beobachteten Märkte liefern frische Daten.'};
 if(risk.accounts.some(a=>a.current===null))
  return {color:'yellow',title:'Schutzstatus nicht vollständig',reason:'Mindestens eine Sicherheitsbewertung ist nicht verfügbar.'};
 return {color:'yellow',title:'Bisher keine Störung erkennbar',reason:'Automatischer Kontenabgleich und Strategieüberwachung sind noch nicht vollständig nachgewiesen.'};
}
export type EquityPoint={accountId:string;ts:number;equity:number};
export type Change={value:number;percent:number|null};
export function changeSince(points:readonly EquityPoint[],accountId:string,now:number,periodMs:number,current:number|null):Change|null {
 if(current===null||!Number.isFinite(current))return null;
 const target=now-periodMs;
 const earlier=points.filter(p=>p.accountId===accountId&&Number.isFinite(p.equity)&&p.equity>=0&&p.ts<=target).sort((a,b)=>b.ts-a.ts)[0];
 if(!earlier)return null;
 return {value:current-earlier.equity,percent:earlier.equity>0?(current/earlier.equity-1)*100:null};
}
/** Maximum observed drop; this is not a full-history claim if snapshots are missing. */
export function observedMaxDrop(points:readonly EquityPoint[],accountId:string):number|null {
 const history=points.filter(p=>p.accountId===accountId&&Number.isFinite(p.equity)&&p.equity>=0).sort((a,b)=>a.ts-b.ts);
 if(!history.length)return null;
 let peak=0,max=0;
 for(const point of history){peak=Math.max(peak,point.equity);if(peak>0)max=Math.max(max,(peak-point.equity)/peak*100);}
 return max;
}
