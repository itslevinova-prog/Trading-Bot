import { mkdir, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ArchiveRegimeProvider, LiveRegimeProvider } from './providers.js';
import { DAY_MS, utcDay } from './math.js';
import { summarizeStates, forwardReturns } from './validation.js';
import type { CandleSource, UniverseAt } from './types.js';

type Adapter = { source: CandleSource; universeAt: UniverseAt };
const empty: Adapter = {
  source: { getCandles: async () => [], listSymbols: async () => [] },
  universeAt: async () => []
};
async function run() {
  const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  const getArg = (flag: string) => {
    const value = process.argv.find(argument => argument.startsWith(flag + '='));
    return value?.slice(flag.length + 1);
  };
  const modulePath = getArg('--adapter');
  // No present-day ranking is permitted as a stand-in for historical PIT breadth.
  const adapter: Adapter = modulePath
    ? (await import(pathToFileURL(resolve(repoRoot, modulePath)).href)) as Adapter
    : empty;
  if (!adapter.source?.getCandles || !adapter.universeAt) throw Error('Adapter muss source und universeAt exportieren');
  const development = process.argv.includes('--development');
  const last = development ? Date.UTC(2023, 11, 31) : utcDay(Date.now());
  const first = development ? Date.UTC(2020, 0, 1) : last - 364 * DAY_MS;
  const provider = development
    ? new ArchiveRegimeProvider(adapter)
    : new LiveRegimeProvider({ ...adapter, loadMissing: !!modulePath });
  const states = await provider.getHistory(first, last);
  const latest = states.at(-1)!;
  const summary = summarizeStates(states);
  const missing = states.filter(s => s.reasons.some(r => r.startsWith('Daten unvollständig'))).length;
  const outcomes = development && modulePath && missing < states.length
    ? await forwardReturns(states, adapter.source, adapter.universeAt, Date.UTC(2024, 0, 1))
    : null;
  const result = {
    model: 'market-regime-v1', variantsTested: 1, mode: development ? 'development-2020-2023' : 'operational-live',
    generatedAt: new Date().toISOString(), complete: missing === 0,
    dataWarning: missing ? 'Daten unvollständig: fehlende PIT- oder 1d-Historie; keine Risikosignale ersetzen' : null,
    latest, summary, forwardReturns30d: outcomes,
    backtestComparison: null, backtestWarning: 'Benötigt die noch nicht gemergte #5-Backtest-Engine',
    history: states
  };
  const output = getArg('--output') ?? ('data/regime/' + (development ? 'development-' : 'live-') +
    new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  const file = resolve(repoRoot, output);
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, 'wx'); // never overwrite an existing local report
  try { await handle.writeFile(JSON.stringify(result, null, 2) + '\n', 'utf8'); }
  finally { await handle.close(); }
  process.stdout.write(
    'Marktregime v1: ' + latest.regime + ' (Score ' + latest.score.toFixed(3) + ')\n' +
    latest.reasons.map(reason => '• ' + reason).join('\n') + '\n' +
    'Letzte ' + states.length + ' Tage: ' + missing + ' unvollständig, ' +
    summary.switches + ' erfasste Wechsel, Wechsel/Jahr ' +
    (summary.switchesPerYear?.toFixed(2) ?? 'nicht verfügbar') + '\n' +
    'JSON-Bericht: ' + output + '\n'
  );
}
run().catch(error => { process.stderr.write('regime:report: ' + String(error) + '\n'); process.exitCode = 1; });
