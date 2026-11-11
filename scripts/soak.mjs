import {appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {SamplingEvidence, validateProbe} from './soak-core.mjs';
import {launchLock, pidAlive} from './process-guard.mjs';
import {hash} from './candidate-files.mjs';

const sourceFiles = ['soak.mjs', 'soak-core.mjs', 'process-guard.mjs', 'candidate-files.mjs'].map(name => ({name, bytes: readFileSync(new URL('./' + name, import.meta.url))}));
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file.name, hash(file.bytes)]));
const sourceSetHash = hash(JSON.stringify(sourceHashes));
const argument = name => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
const hours = Number(argument('--hours') ?? 10), intervalMs = Number(argument('--interval-ms') ?? 60000), label = argument('--label');
if (!Number.isFinite(hours) || hours <= 0 || hours > 72) throw Error('hours must be >0 and <=72');
if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60000) throw Error('interval-ms must be 1000..60000');
if (label !== undefined && !/^[a-z][a-z0-9-]{0,31}$/.test(label)) throw Error('Invalid monitor label');
const base = new URL(process.env.SOAK_URL ?? 'http://127.0.0.1:3000');
if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) throw Error('Soak monitoring is local only, without credentials');
const out = resolve('data/soak', label ?? ''); mkdirSync(out, {recursive: true});
// The original monitor predates launch locks. Do not overwrite its live default latest.json.
if (!label && existsSync('data/soak-process.json')) {
  const legacy = JSON.parse(readFileSync('data/soak-process.json', 'utf8'));
  if (pidAlive(legacy.pid)) throw Error('Recorded default monitor is active; use a distinct --label');
}
const release = launchLock(join(out, 'monitor.lock'));
try {
  if (existsSync(join(out, 'latest.json'))) {
    const previous = readFileSync(join(out, 'latest.json')), archived = join(out, 'previous-' + hash(previous) + '.json');
    if (!existsSync(archived)) writeFileSync(archived, previous, {flag: 'wx'});
  }
  const sourceArchive = join(out, 'source-archives', sourceSetHash); mkdirSync(sourceArchive, {recursive: true});
  for (const source of sourceFiles) {const target = join(sourceArchive, source.name); if (existsSync(target)) {if (hash(readFileSync(target)) !== sourceHashes[source.name]) throw Error('Archived monitor source changed');} else writeFileSync(target, source.bytes, {flag: 'wx'});}
  const startWall = Date.now(), startMonotonic = performance.now(), durationMs = hours * 3600000;
  const evidence = new SamplingEvidence({startWall, startMonotonic, durationMs, intervalMs});
  const file = join(out, new Date(startWall).toISOString().replaceAll(':', '-') + '.jsonl');
  const metadata = {pid: process.pid, startedAtApprox: new Date(startWall).toISOString(), sourceOrigin: base.origin, label: label ?? 'default', hours, intervalMs, monitorOnly: true, activeDevelopmentTimeMs: 0};
  writeFileSync(join(out, 'process.json'), JSON.stringify(metadata, null, 2));
  let stopping = false, wake;
  const stop = () => {stopping = true; wake?.();}; process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const get = async path => {const response = await fetch(new URL('/api/' + path, base), {signal: AbortSignal.timeout(10000), redirect: 'error'}); if (!response.ok) throw Error('Local endpoint status'); return response.json();};
  const state = ended => ({...metadata, ...evidence.summary({wall: Date.now(), monotonic: performance.now(), ended, stopped: stopping}), file, sourceHashes, sourceSetHash, sourceArchive});
  const publish = value => {const temp = join(out, 'latest.' + process.pid + '.tmp'); writeFileSync(temp, JSON.stringify(value, null, 2)); renameSync(temp, join(out, 'latest.json'));};
  console.log(JSON.stringify({message: 'Local passive paper sampling started', ...metadata}));
  while (!stopping && performance.now() - startMonotonic < durationMs) {
    const tick = performance.now(); let sample;
    try {const before = await get('provenance');const [health, accounts] = await Promise.all([get('health'), get('accounts')]);const after = await get('provenance');sample = validateProbe(health, accounts, after, before);}
    catch (error) {sample = {error: 'Local paper endpoints unavailable, non-paper, malformed or changing', errorKind: error?.message === 'RUNTIME_CHANGED_DURING_PROBE' ? error.message : 'ENDPOINT_UNAVAILABLE_OR_INVALID'};}
    const wall = Date.now(), monotonic = performance.now(); evidence.observe({wall, monotonic, sample});
    appendFileSync(file, JSON.stringify({ts: wall, elapsedMs: monotonic - startMonotonic, ...sample}) + '\n'); publish(state(false));
    const wait = Math.max(1, Math.min(intervalMs - (performance.now() - tick), durationMs - (performance.now() - startMonotonic)));
    await new Promise(done => {const timer = setTimeout(done, wait); wake = () => {clearTimeout(timer); done();};}); wake = undefined;
  }
  const result = state(true); publish(result); console.log(JSON.stringify({message: 'Local passive sampling finished', ...result}));
} finally {release();}
