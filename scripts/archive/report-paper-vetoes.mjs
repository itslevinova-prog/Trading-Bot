import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

const [file, runId, buildId, evaluationVersion, revision] = process.argv.slice(2);
const policyRevision = Number(revision);
assert(file && /^[0-9a-f-]{36}$/.test(runId ?? '') && /^[0-9a-f]{64}$/.test(buildId ?? ''),
  'Expected a database path, run ID and build ID');
assert(/^[0-9a-f]{64}$/.test(evaluationVersion ?? '') && /^(0|[1-9][0-9]*)$/.test(revision ?? '') && Number.isSafeInteger(policyRevision),
  'Expected an evaluation version and numeric policy revision after the build ID');

const db = new DatabaseSync(file, {readOnly: true});
let rows;
try {
  rows = db.prepare(`
    SELECT d.id, d.ts, e.evidence_json, json_extract(d.context_json, '$.marketContext.markets') AS markets_json
    FROM decisions d LEFT JOIN decision_evidence e ON e.decision_id = d.id
    WHERE d.account_id = 'ai' AND d.provider = 'mock'
      AND json_extract(d.context_json, '$.execution.mode') = 'paper'
      AND json_extract(d.context_json, '$.execution.runId') = ?
      AND json_extract(d.context_json, '$.execution.buildId') = ?
      AND json_extract(d.context_json, '$.execution.evaluationVersion') = ?
      AND json_extract(d.context_json, '$.tradingPolicy.revision') = ?
      AND json_extract(d.context_json, '$.execution.simulation') IS NULL
    ORDER BY d.ts, d.id
  `).all(runId, buildId, evaluationVersion, policyRevision);
} finally {
  db.close();
}
assert(rows.length, 'No matching paper decisions');

const resistance = 'historical-resistance-before-target';
const breakout = 'close-above-excluding-signal-prior-range';
const clocks = new Map();
let unavailable = 0;
let repeatedClockDecisions = 0;
for (const row of rows) {
  const evidence = JSON.parse(row.evidence_json);
  const {assessments, asOf} = evidence ?? {};
  if (!Number.isSafeInteger(asOf) || asOf < 0 || asOf > row.ts || !Array.isArray(assessments)) {
    unavailable++;
    continue;
  }
  const clock = Math.floor(asOf / 900000) * 900000;
  if (clocks.has(clock)) {
    repeatedClockDecisions++;
    continue;
  }
  const markets = new Map();
  for (const market of JSON.parse(row.markets_json) ?? []) {
    // Duplicate context rows are ambiguous.
    markets.set(market.pair, markets.has(market.pair) ? null : market);
  }
  const spreadByPair = new Map();
  const pairs = new Set();
  const hits = new Map();
  const soleResistance = [];
  const breakoutWithResistance = [];
  let buyCandidates = 0;
  for (const assessment of assessments) {
    const {pair, action, contradictions, support} = assessment;
    assert(typeof pair === 'string' && !pairs.has(pair), 'Missing or duplicate assessed pair');
    assert(Array.isArray(contradictions) && contradictions.every(x => typeof x === 'string') && Array.isArray(support),
      'Invalid assessment evidence');
    pairs.add(pair);
    if (action === 'buy') buyCandidates++;
    if (support.includes('fresh-matching-closed-candle-and-book')) {
      const book = markets.get(pair)?.microstructure;
      const bid = Number(book?.bids?.[0]?.price), ask = Number(book?.asks?.[0]?.price);
      const spread = (ask - bid) / (ask / 2 + bid / 2) * 10000;
      if (bid > 0 && ask >= bid && Number.isFinite(spread)) spreadByPair.set(pair,spread);
    }
    const vetoes = new Set(contradictions);
    for (const reason of vetoes) hits.set(reason, (hits.get(reason) ?? 0) + 1);
    if (vetoes.has(resistance)) {
      if (vetoes.size === 1) soleResistance.push(pair);
      if (support.includes(breakout)) breakoutWithResistance.push(pair);
    }
  }
  const spreads = [...spreadByPair.values()].sort((a,b) => a-b);
  const mid = Math.floor(spreads.length / 2);
  const medianBps = spreads.length === 0 ? null
    : spreads.length % 2 ? spreads[mid] : (spreads[mid-1] + spreads[mid]) / 2;
  const observedSpreads = {count: spreads.length, missing: pairs.size - spreads.length,
    byPairBps: Object.fromEntries(spreadByPair),
    medianBps, minBps: spreads[0] ?? null, maxBps: spreads.at(-1) ?? null,
    above10Bps: spreads.filter(x => x > 10).length, above20Bps: spreads.filter(x => x > 20).length};
  clocks.set(clock, {clock, decisionId: row.id, decisionAt: row.ts, marketSlots: pairs.size, buyCandidates,
    observedSpreads, vetoHits: Object.fromEntries(hits), soleResistance, breakoutWithResistance});
}
console.log(JSON.stringify({runId, buildId, evaluationVersion, policyRevision, matchingDecisions: rows.length, unavailable, repeatedClockDecisions,
  distinctClocks: clocks.size, clocks: [...clocks.values()],
  scope: 'Earliest decision with evidence per UTC 15-minute bucket. Vetoes overlap and markets share clocks. Candidate counts precede execution. Spreads describe confirmed top-of-book snapshots at decision time.'}, null, 2));
