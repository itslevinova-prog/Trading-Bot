export type Headline={title:string;url:string;publishedAt:number};
const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function decode(text:string){return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,code:string)=>{if(code.startsWith('#')){const n=code[1]?.toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}return entities[code.toLowerCase()]??'';});}
/** Bounded RSS item metadata only; no DTD, entity expansion or external fetch. */
export function parseHeadlines(xml:string,now=Date.now(),limit=6):Headline[]{
 if(xml.length>1000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('Unsafe or oversized RSS');
 const field=(item:string,name:string)=>{const value=item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]??'';return decode(value.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/,'$1').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();};
 const found:Headline[]=[];
 for(const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
  const item=match[1]!,title=field(item,'title').slice(0,180),publishedAt=Date.parse(field(item,'pubDate'));
  let url:URL;try{url=new URL(field(item,'link'));}catch{continue;}
  if(!title||url.protocol!=='https:'||url.username||url.password||!Number.isFinite(publishedAt)||publishedAt>now+60000||now-publishedAt>48*3600000)continue;
  if(found.some(h=>h.url===url.href))continue;found.push({title,url:url.href,publishedAt});
  if(found.length>=Math.min(12,Math.max(1,limit)))break;
 }
 return found.sort((a,b)=>b.publishedAt-a.publishedAt);
}
