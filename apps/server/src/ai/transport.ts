/** Bounded, redacted JSON transport; no provider bodies, URLs or headers enter errors. */
export async function requestJson(request:typeof fetch,url:URL,init:RequestInit,limit=100000,timeoutMs=45000):Promise<any>{
 let response:Response;try{response=await request(url,{...init,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{throw Error('KI-Netzwerkfehler; keine automatische Wiederholung');}
 if(!response.ok)throw Error(`KI-Anbieter HTTP ${response.status}; keine automatische Wiederholung`);
 if(!response.body)throw Error('Leere KI-Antwort');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){let row:ReadableStreamReadResult<Uint8Array>;try{row=await reader.read();}catch{throw Error('KI-Antwort unvollständig');}if(row.done)break;size+=row.value.byteLength;if(size>limit)throw Error('KI-Antwort zu gross');chunks.push(row.value);}}finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Ungültiges KI-Antwortformat');}
}
