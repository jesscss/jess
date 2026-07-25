#!/usr/bin/env node
/**
 * Generic vitest ratchet: run a package's suite and compare the set of FAILING
 * tests against a checked-in, NAMED baseline.
 *
 * Why a set and not a count: a count ("15 known failures") cannot tell
 * "nothing changed" apart from "you fixed one and broke another" — both read
 * as 15. Every entry here is a specific test name, so the failure message and
 * the git diff both say exactly which test moved and in which direction.
 *
 * Movement rules:
 *   - a test failing that is NOT in the baseline  -> FAIL (a new regression)
 *   - a baseline test that now PASSES             -> FAIL, "remove this entry"
 *     (shrinking is a one-line, obviously-correct edit; it must be deliberate
 *      so the debt cannot silently drift back up)
 *   - a baseline test that no longer exists       -> FAIL, "stale entry"
 *   - an entry marked `"flaky": true`             -> reported, never gating
 *     (a flaky entry is an OPEN BUG parked here with a pointer, not an excuse)
 *
 * Usage: node scripts/vitest-ratchet.mjs --package <dir> --baseline <json>
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const packageDir = path.resolve(process.cwd(), arg('--package') ?? '.');
const baselinePath = path.resolve(process.cwd(), arg('--baseline') ?? path.join(packageDir, 'test/known-failures.json'));
const updating = args.includes('--print-current');

if (!existsSync(baselinePath)) {
  console.error(`vitest-ratchet: baseline not found: ${baselinePath}`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const entries = baseline.knownFailures ?? [];
for (const entry of entries) {
  if (typeof entry.test !== 'string' || entry.test.length === 0) {
    console.error(`vitest-ratchet: every baseline entry needs a "test" name (${baselinePath})`);
    process.exit(1);
  }
}

const outDir = mkdtempSync(path.join(tmpdir(), 'jess-ratchet-'));
const outFile = path.join(outDir, 'results.json');

console.log(`vitest-ratchet: ${path.relative(process.cwd(), packageDir) || '.'} vs ${path.relative(process.cwd(), baselinePath)}`);
const run = spawnSync(
  'npx',
  ['vitest', '--run', '--reporter=json', `--outputFile=${outFile}`],
  {
    cwd: packageDir,
    env: { ...process.env, TEST: 'true' },
    stdio: ['ignore', 'inherit', 'inherit'],
    encoding: 'utf8'
  }
);

if (run.error) {
  console.error(`vitest-ratchet: could not run vitest: ${run.error.message}`);
  process.exit(1);
}
if (!existsSync(outFile)) {
  // No machine-readable result at all means the runner itself died (import
  // error, config error, OOM). That is never a "known failure".
  console.error('vitest-ratchet: vitest produced no JSON report — the runner itself failed.');
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

const report = JSON.parse(readFileSync(outFile, 'utf8'));
rmSync(outDir, { recursive: true, force: true });

/** `test/foo.test.ts > Suite name test name` — stable across machines. */
const idOf = (file, assertion) => `${path.relative(packageDir, file).split(path.sep).join('/')} > ${assertion.fullName}`;

const failing = new Set();
const present = new Set();
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    const id = idOf(file.name, assertion);
    present.add(id);
    if (assertion.status === 'failed') {
      failing.add(id);
    }
  }
}

if (updating) {
  console.log(JSON.stringify([...failing].sort(), null, 2));
  process.exit(0);
}

const flaky = new Set(entries.filter(entry => entry.flaky === true).map(entry => entry.test));
const gating = entries.filter(entry => entry.flaky !== true).map(entry => entry.test);
const gatingSet = new Set(gating);

const newFailures = [...failing].filter(id => !gatingSet.has(id) && !flaky.has(id)).sort();
const nowPassing = gating.filter(id => present.has(id) && !failing.has(id)).sort();
const stale = [...gatingSet, ...flaky].filter(id => !present.has(id)).sort();
const flakyObserved = [...flaky].filter(id => failing.has(id)).sort();

console.log('');
console.log(`  tests: ${report.numTotalTests ?? '?'}   failing: ${failing.size}   baseline (gating): ${gating.length}   baseline (flaky): ${flaky.size}`);

if (flakyObserved.length > 0) {
  console.log('');
  console.log('  FLAKY (known-unstable, not gating — see the baseline entry for the investigation):');
  for (const id of flakyObserved) {
    console.log(`    ~ ${id}`);
  }
}

let failed = false;

if (newFailures.length > 0) {
  failed = true;
  console.error('');
  console.error(`NEW FAILURES (${newFailures.length}) — not in the baseline. Fix them; do not add them here to go green:`);
  for (const id of newFailures) {
    console.error(`  + ${id}`);
  }
}

if (nowPassing.length > 0) {
  failed = true;
  console.error('');
  console.error(`FIXED (${nowPassing.length}) — these now PASS. Delete their entries from ${path.relative(process.cwd(), baselinePath)} so the debt cannot creep back:`);
  for (const id of nowPassing) {
    console.error(`  - ${id}`);
  }
}

if (stale.length > 0) {
  failed = true;
  console.error('');
  console.error(`STALE (${stale.length}) — baseline names a test that no longer exists. Delete or rename the entry:`);
  for (const id of stale) {
    console.error(`  ? ${id}`);
  }
}

if (failed) {
  console.error('');
  console.error('The baseline is a NAMED SET, not a count: it may shrink freely, but it only grows by a deliberate, reviewable edit.');
  process.exit(1);
}

console.log('');
console.log('vitest-ratchet: pass set matches the baseline exactly.');
