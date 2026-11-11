import type {ExportFile} from './export.js';

/** Dependency-free ZIP (STORE) with CRC32, for a small local download archive. */
function crc32(bytes:Buffer):number {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export function createTaxZip(files:ExportFile[],folder:string):Buffer {
  if(!/^[a-zA-Z0-9_-]+$/.test(folder))throw Error('Ungültiger ZIP-Ordner');
  const locals:Buffer[]=[],centrals:Buffer[]=[];
  let offset=0;
  for(const file of files){
    if(!/^[a-zA-Z0-9._-]+$/.test(file.name))throw Error('Ungültiger ZIP-Dateiname');
    const name=Buffer.from(folder+'/'+file.name,'utf8'),data=file.content,crc=crc32(data);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(0,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);
    local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    locals.push(local,name,data);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    central.writeUInt16LE(0x800,8);central.writeUInt16LE(0,10);central.writeUInt32LE(crc,16);
    central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
    central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    centrals.push(central,name);
    offset+=local.length+name.length+data.length;
  }
  const centralSize=centrals.reduce((n,b)=>n+b.length,0),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,...centrals,end]);
}
