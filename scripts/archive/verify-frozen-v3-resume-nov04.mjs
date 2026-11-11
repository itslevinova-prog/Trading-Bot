import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {verifyMockExperiment} from './mock-experiment-files.mjs';
import {digest} from '../apps/server/dist/provenance/build.js';

const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const input = read('data/frozen-v3-nov04-resume-input.json');
const before = read(input.proof);
assert.equal(digest(fs.readFileSync(before.backup)), input.sha);
assert.equal(before.sha, input.sha);
const actual = await verifyMockExperiment(process.cwd(), 'v3');
const pointer = read('data/mock-experiment-v3-current.json');
const current = read(join(pointer.root, 'data/process.json'));
assert.equal(current.runId, actual.runId);
assert.equal(current.resumedFromRunId, before.previous.runId);
assert.notEqual(current.runId, before.previous.runId);
assert.equal(before.file, join(pointer.root, 'data/mock-experiment.db'));

const Database = createRequire(resolve('apps/server/package.json'))('better-sqlite3');
function inspect(path, lastBefore) {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
        return db.transaction(() => ({
            accounts: db.prepare('SELECT id,name,strategy,starting_balance,created_at FROM accounts ORDER BY id').all(),
            epochs: db.prepare('SELECT * FROM forward_epochs ORDER BY id').all(),
            trades: db.prepare('SELECT * FROM trades ORDER BY id').all(),
            contracts: db.prepare('SELECT * FROM paper_experiments ORDER BY id').all(),
            runs: db.prepare('SELECT run_id,experiment_id,first_seen FROM paper_experiment_runs ORDER BY first_seen').all(),
            last: db.prepare('SELECT MAX(captured_at) AS ts FROM paper_experiment_samples').get().ts,
            firstAfter: db.prepare('SELECT MIN(captured_at) AS ts FROM paper_experiment_samples WHERE captured_at>?').get(lastBefore).ts,
        }))();
    } finally {
        db.close();
    }
}

const old = inspect(before.backup, 0);
const next = inspect(before.file, old.last);
for (const key of ['accounts', 'epochs', 'contracts']) assert.deepEqual(next[key], old[key]);
for (const key of ['trades', 'runs']) {
    const identity = key === 'runs' ? 'run_id' : 'id';
    for (const row of old[key]) assert.deepEqual(next[key].find(x => x[identity] === row[identity]), row);
}
assert.ok(next.firstAfter >= Date.parse(current.startedAtApprox), 'First new observation must follow the recorded process launch');
const facts = {
    verifiedAt: new Date().toISOString(),
    priorRunId: before.previous.runId,
    runId: current.runId,
    pid: current.pid,
    frozenBuildId: before.buildId,
    backupProof: input.proof,
    backupSha256: input.sha,
    preserved: Object.fromEntries(['accounts','epochs','contracts','trades','runs'].map(k => [k, old[k].length])),
    lastObservedBefore: old.last,
    firstObservedAfter: next.firstAfter,
    observationGapMs: next.firstAfter - old.last,
    paperOnly: true,
    profitabilityEstablished: false,
};
const bytes = JSON.stringify(facts, null, 2) + '\n';
const sha = digest(bytes), path = 'data/frozen-v3-resume-proof-' + sha.slice(0, 16) + '.json';
fs.writeFileSync(path, bytes, { flag: 'wx' });
console.log(JSON.stringify({ path, sha, ...facts }));
