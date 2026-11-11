#!/usr/bin/env node
// Datenschutz-Wächter für dieses öffentliche Repository.
//
// Prüft neue Dateiinhalte, Commit-Metadaten und Texte (Issues, Kommentare, PRs)
// auf private Daten. Gibt NIE den gefundenen Text aus, nur Ort und Regel, weil
// die Logs öffentlicher Repositories öffentlich sind.
//
// Private Wörter stehen bewusst NICHT im Repository (auch nicht als Hash, der
// sich mit Wortlisten erraten ließe), sondern nur im GitHub-Secret
// PRIVACY_BLOCKLIST (Komma- oder Zeilen-getrennt). Ohne Secret gelten nur die
// allgemeinen Regeln (E-Mails, Benutzerpfade, Chat-Links, Schlüssel).
//
// Modi (Umgebungsvariable PG_MODE):
//   diff  – PG_BASE..PG_HEAD: hinzugefügte Zeilen und Commit-Metadaten
//   full  – alle versionierten Dateien
//   text  – PG_TEXT_* Umgebungsvariablen (z. B. Issue-Titel und -Text)
//
// Lokal: PRIVACY_BLOCKLIST="…" node .github/privacy-guard/check.mjs  (Standard: full)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Fremde Open-Source-Dateien mit Lizenztexten (enthalten E-Mails ihrer Autoren).
const EXCLUDED_PATHS = [/^docs\/local-tree-libraries\//, /^docs\/upstream-research\//, /^pnpm-lock\.yaml$/, /(^|\/)node_modules\//];

const ALLOWED_EMAIL = [
  /@users\.noreply\.github\.com$/i,
  /^noreply@github\.com$/i,
  /^noreply@anthropic\.com$/i,
  /@(example\.(com|org|net)|localhost|test\.invalid)$/i,
];
const ALLOWED_COMMIT_NAMES = new Set(['itslevinova-prog', 'Claude', 'GitHub', 'github-actions[bot]', 'dependabot[bot]', 'Copilot', 'copilot-swe-agent[bot]']);
const ALLOWED_USER_DIRS = new Set(['user', 'runner', 'runneradmin', 'public', 'default', 'shared', 'node', 'ubuntu', 'name', 'username', '<name>', '<user>', '...', '…']);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,6}\b/g;
const USER_DIR = [
  /[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+([^\\/\s"'`<>|:*?]+)/gi,
  /\/Users\/([A-Za-z0-9._-]+)/g,
  /\/home\/([A-Za-z0-9._-]+)/g,
];
const CHAT_LINK = /(claude\.ai\/(code\/session_|chat\/|share\/)|chatgpt\.com\/(c|share|codex|g)\/|chat\.openai\.com\/(c|share)\/)/i;
const SECRET = /(-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[0-9A-Z]{16}\b|\bsk-ant-[A-Za-z0-9_-]{20,}|\bsk-proj-[A-Za-z0-9_-]{20,}|\bxox[abp]-[A-Za-z0-9-]{10,})/;

const normalize = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const blocked = new Set(
  (process.env.PRIVACY_BLOCKLIST ?? '')
    .split(/[\n,;]+/)
    .flatMap((w) => normalize(w.trim()).split(/[^a-z0-9]+/))
    .filter((w) => w.length >= 3),
);

/** Returns rule names violated by one line of text (never the matched text). */
export function violations(line) {
  const found = new Set();
  if (blocked.size) {
    for (const word of normalize(line).split(/[^a-z0-9]+/)) {
      if (blocked.has(word)) found.add('blockiertes Wort (privater Name/Begriff)');
    }
  }
  for (const m of line.matchAll(EMAIL)) {
    if (!ALLOWED_EMAIL.some((re) => re.test(m[0]))) found.add('E-Mail-Adresse (nur Noreply-Adressen erlaubt)');
  }
  for (const re of USER_DIR) {
    for (const m of line.matchAll(re)) {
      if (!ALLOWED_USER_DIRS.has(m[1].toLowerCase())) found.add('persönlicher Benutzerpfad');
    }
  }
  if (CHAT_LINK.test(line)) found.add('Link zu einem privaten Chat/einer KI-Session');
  if (SECRET.test(line) && !/DUMMY/.test(line)) found.add('möglicher geheimer Schlüssel');
  return [...found];
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const excluded = (path) => EXCLUDED_PATHS.some((re) => re.test(path));
const problems = [];
const report = (where, rules) => rules.forEach((rule) => problems.push(`${where}: ${rule}`));

function scanDiff(base, head) {
  let file = null;
  let lineNo = 0;
  for (const raw of git('diff', '--unified=0', '--no-color', '--no-ext-diff', `${base}..${head}`).split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); continue; }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (raw.startsWith('+') && file && file !== '/dev/null') {
      if (!excluded(file)) report(`${file}:${lineNo}`, violations(raw.slice(1)));
      lineNo++;
    }
  }
  for (const entry of git('log', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e', `${base}..${head}`).split('\x1e')) {
    const [sha, an, ae, cn, ce, msg] = entry.trim().split('\x1f');
    if (!sha) continue;
    const at = `Commit ${sha.slice(0, 7)}`;
    if (!ALLOWED_COMMIT_NAMES.has(an) || !ALLOWED_COMMIT_NAMES.has(cn)) report(at, ['Autor-/Committer-Name nicht erlaubt (itslevinova-prog verwenden)']);
    if (![ae, ce].every((e) => ALLOWED_EMAIL.some((re) => re.test(e)))) report(at, ['Autor-/Committer-E-Mail nicht erlaubt (Noreply-Adresse verwenden)']);
    (msg ?? '').split('\n').forEach((l, i) => report(`${at} Nachricht Zeile ${i + 1}`, violations(l)));
  }
}

function scanFull() {
  for (const file of git('ls-files', '-z').split('\0').filter(Boolean)) {
    if (excluded(file)) continue;
    let text;
    try { text = readFileSync(file); } catch { continue; }
    if (text.subarray(0, 8000).includes(0)) continue;
    text.toString('utf8').split('\n').forEach((l, i) => report(`${file}:${i + 1}`, violations(l)));
  }
}

function scanText() {
  const texts = {};
  // Im Workflow kommen die Texte aus der Ereignis-Datei (GITHUB_EVENT_PATH), nicht
  // aus Umgebungsvariablen: GitHub schreibt Step-Umgebungsvariablen ins öffentliche Log.
  if (process.env.GITHUB_EVENT_PATH) {
    const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const name = process.env.GITHUB_EVENT_NAME;
    if (ev.pull_request) Object.assign(texts, { pr_titel: ev.pull_request.title, pr_text: ev.pull_request.body });
    if (ev.issue) texts.issue_titel = ev.issue.title;
    if (ev.issue && name === 'issues') texts.issue_text = ev.issue.body;
    if (ev.comment) texts.kommentar = ev.comment.body;
    if (ev.review) texts.review = ev.review.body;
  }
  // Lokal/Tests: PG_TEXT_*-Variablen.
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PG_TEXT_')) texts[key.slice(8).toLowerCase()] = value;
  }
  for (const [key, value] of Object.entries(texts)) {
    if (value) String(value).split('\n').forEach((l, i) => report(`${key} Zeile ${i + 1}`, violations(l)));
  }
}

const mode = process.env.PG_MODE ?? 'full';
if (mode === 'selftest') { /* nur violations() exportieren */ } else {
if (!blocked.size) console.warn('⚠️ Secret PRIVACY_BLOCKLIST fehlt oder ist leer: nur allgemeine Regeln aktiv.');
if (mode === 'diff') scanDiff(process.env.PG_BASE, process.env.PG_HEAD);
else if (mode === 'text') scanText();
else scanFull();

if (problems.length) {
  console.error(`❌ Datenschutz-Wächter: ${problems.length} Fund(e). Der Inhalt wird absichtlich nicht angezeigt.`);
  for (const p of problems.slice(0, 200)) console.error(`  - ${p}`);
  console.error('Bitte die Stellen entfernen bzw. Commits mit itslevinova-prog und der Noreply-Adresse neu erstellen (siehe AGENTS.md).');
  process.exit(1);
}
console.log(`✅ Datenschutz-Wächter (${mode}): keine privaten Daten gefunden.`);
}
