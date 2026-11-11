import type {Level,OrderBook} from '@paper/shared';
// Kraken v2 checksum: top ten asks asc then bids desc, concatenate decimal-stripped strings.
function normalized(s:string):string{return s.replace('.','').replace(/^0+/,'')||'0';}
export function crc32(input:string):number{let crc=0xffffffff;for(let i=0;i<input.length;i++){crc^=input.charCodeAt(i);for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function side(levels:Level[],ascending:boolean):Level[]{return levels.sort((a,b)=>ascending?Number(a.price)-Number(b.price):Number(b.price)-Number(a.price)).slice(0,10);}
export function bookChecksum(book:Pick<OrderBook,'asks'|'bids'>):number{return crc32([...side([...book.asks],true),...side([...book.bids],false)].map(l=>normalized(l.price)+normalized(l.qty)).join(''));}
export function updateBook(current:OrderBook|undefined,message:{symbol:string;bids:Level[];asks:Level[];checksum:number},snapshot:boolean):OrderBook{
 if(!snapshot&&(!current||!current.valid))throw new Error('Kein gültiger Snapshot');
 const bids=new Map((snapshot?[]:current!.bids).map(l=>[l.price,l.qty]));const asks=new Map((snapshot?[]:current!.asks).map(l=>[l.price,l.qty]));
 for(const [updates,side] of [[message.bids,bids],[message.asks,asks]] as const){for(const level of updates){if(Number(level.qty)===0)side.delete(level.price);else side.set(level.price,level.qty);}}
 const book:OrderBook={symbol:message.symbol,bids:side([...bids].map(([price,qty])=>({price,qty})),false),asks:side([...asks].map(([price,qty])=>({price,qty})),true),receivedAt:Date.now(),valid:true};
 book.valid=bookChecksum(book)===message.checksum;
 return book;
}
export function bookVWAP(levels:Level[],side:'buy'|'sell',qty:number):number|null{
 let remain=qty,total=0;for(const l of [...levels].sort((a,b)=>side==='buy'?Number(a.price)-Number(b.price):Number(b.price)-Number(a.price))){const take=Math.min(remain,Number(l.qty));if(take>0){total+=take*Number(l.price);remain-=take;}if(remain<1e-12)break;}return remain>1e-10?null:total/qty;
}
export function quantityForBudget(asks:Level[],budget:number):number|null{
 let remaining=budget,quantity=0;for(const level of [...asks].sort((a,b)=>Number(a.price)-Number(b.price))){const price=Number(level.price),value=price*Number(level.qty);if(price<=0)continue;const take=Math.min(value,remaining);quantity+=take/price;remaining-=take;if(remaining<1e-8)break;}return remaining>1e-6?null:quantity;
}
