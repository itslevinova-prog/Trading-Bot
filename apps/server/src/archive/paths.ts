import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Works from tsx sources and compiled dist/archive regardless of current cwd.
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const ARCHIVE_ROOT = resolve(PROJECT_ROOT, 'data/archive');
export const ARCHIVE_RAW = resolve(ARCHIVE_ROOT, 'raw');
export const ARCHIVE_DB = resolve(ARCHIVE_ROOT, 'binance-spot-archive.db');
export const HOLDOUT_LOG = resolve(ARCHIVE_ROOT, 'holdout-access.log');
export const ARCHIVE_REPORT = resolve(ARCHIVE_ROOT, 'report.json');
export const ARCHIVE_DOC = resolve(PROJECT_ROOT, 'docs/DATA-ARCHIVE.md');
