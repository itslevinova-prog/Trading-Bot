import {inflateRawSync} from 'node:zlib';

// Read the single CSV entry by following ZIP's central directory (data-descriptor safe).
// Public archives are SHA256 checked before this function is called.
export function extractArchiveCsv(zip: Buffer): string {
  const minimum = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let i = zip.length - 22; i >= minimum; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw Error('Invalid ZIP: end of central directory missing');
  const count = zip.readUInt16LE(eocd + 10);
  const directory = zip.readUInt32LE(eocd + 16);
  if (count !== 1 || directory + 46 > zip.length) throw Error('Expected exactly one CSV in ZIP');
  if (zip.readUInt32LE(directory) !== 0x02014b50) throw Error('Invalid ZIP directory');
  const flags = zip.readUInt16LE(directory + 8);
  const method = zip.readUInt16LE(directory + 10);
  const compressed = zip.readUInt32LE(directory + 20);
  const uncompressed = zip.readUInt32LE(directory + 24);
  const fileNameLength = zip.readUInt16LE(directory + 28);
  const localOffset = zip.readUInt32LE(directory + 42);
  const name = zip.subarray(directory + 46, directory + 46 + fileNameLength).toString('utf8');
  if (!name.endsWith('.csv') || name.includes('/') || name.includes('\\')) throw Error('Unsafe/non-CSV ZIP entry');
  if ((flags & 1) || ![0, 8].includes(method) || uncompressed > 200_000_000) throw Error('Unsupported ZIP entry');
  if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) throw Error('Invalid local ZIP header');
  const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
  if (start + compressed > zip.length) throw Error('Truncated ZIP');
  const payload = zip.subarray(start, start + compressed);
  const csv = method === 8 ? inflateRawSync(payload, {maxOutputLength: 200_000_000}) : payload;
  if (csv.length !== uncompressed) throw Error('ZIP uncompressed size mismatch');
  return csv.toString('utf8');
}
