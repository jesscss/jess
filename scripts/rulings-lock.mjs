#!/usr/bin/env node
/*
 * The owner-ruling lock: a content hash per owner-ruled ledger row and per
 * owner-ruling conformance test, kept in `docs/architecture/core/owner-rulings.lock.json`.
 * `pnpm check:guardrails` (assertion 4) fails when one changes without the lock.
 *
 * `pnpm rulings:lock` regenerates the lock and prints exactly which rulings
 * changed. Run it ONLY when the owner explicitly approved that change.
 *
 * OWNER-RULED ROW. A ledger row (`| <ID> | ruling | status | source |` in
 * DESIGN-DECISIONS.md) whose status cell either
 *   (a) names the owner as the decider — `owner`, `owner-confirmed`,
 *       `owner ruled`, `OWNER-RULED:` — after discounting the phrases that do
 *       not ("under owner delegation", "owner-delegated", "owner to confirm",
 *       "owner to rule", "owner to ratify", "awaiting the owner", "for owner
 *       review", "pending owner", "owner question"), or
 *   (b) is a decided status (SETTLED, PARTIALLY SETTLED, CLOSED, SUPERSEDED)
 *       that names no other decider (orchestrator, delegation, "(measured)")
 *       — the ledger is the owner's decision ledger, so a decided row
 *       attributed to nobody else is the owner's,
 * and does not lead with an undecided status (OPEN, DEFERRED, DIRECTIONAL,
 * RECORD, FIXED).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const LEDGER = 'docs/architecture/core/DESIGN-DECISIONS.md';
export const RULING_TESTS = 'packages/jess/test/owner-rulings.test.ts';
export const LOCK = 'docs/architecture/core/owner-rulings.lock.json';
const PREAMBLE = '(file preamble: imports and helpers)';

const STATUS_START = /^[*`\s]*(?:SETTLED|PARTIALLY SETTLED|OPEN|FIXED|CLOSED|SUPERSEDED|DEFERRED|DIRECTIONAL|RECORD)\b/;
const UNDECIDED = /^[*`\s]*(?:OPEN|DEFERRED|DIRECTIONAL|RECORD|FIXED)\b/;
const DECIDED = /^[*`\s]*(?:SETTLED|PARTIALLY SETTLED|CLOSED|SUPERSEDED)\b/;
const NOT_THE_OWNER = /under owner delegation|owner-delegated|owner to (?:confirm|rule|re-rule|ratify)|awaiting the owner|for owner review|pending owner|owner question/gi;
const NAMES_OWNER = /\bowner\b|OWNER-RULED:/i;
const OTHER_DECIDER = /orchestrator|delegat|\(measured\)/i;

const hash = text => createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

/* GFM cells: split on unescaped `|`. A broken row (an unescaped `|` in a code span) has extra cells; the status cell is found by its leading keyword. */
function statusCell(line) {
  const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
  return cells.slice(2).find(c => STATUS_START.test(c)) ?? cells[2] ?? '';
}

export function isOwnerRuledStatus(status) {
  if (UNDECIDED.test(status)) {
    return false;
  }
  if (NAMES_OWNER.test(status.replace(NOT_THE_OWNER, ''))) {
    return true;
  }
  return DECIDED.test(status) && !OTHER_DECIDER.test(status);
}

export function ownerRulingRows(text = readFileSync(join(root, LEDGER), 'utf8')) {
  const rows = {};
  for (const line of text.split('\n')) {
    const m = /^\|\s*([A-Z]+\d+[a-z]?)\s*\|/.exec(line);
    if (m && isOwnerRuledStatus(statusCell(line))) {
      rows[m[1]] = hash(line);
    }
  }
  return rows;
}

/* Each `it(…)` / `it.fails(…)` / `it.todo(…)` runs from its title line to the next one; the text before the first is the preamble. */
export function rulingTests(text = readFileSync(join(root, RULING_TESTS), 'utf8')) {
  const lines = text.split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    const m = /^\s*it(?:\.\w+)?\(\s*(['"`])(.*?)\1/.exec(line);
    if (m) {
      starts.push([i, m[2]]);
    }
  });
  const tests = { [PREAMBLE]: hash(lines.slice(0, starts[0]?.[0] ?? lines.length).join('\n')) };
  starts.forEach(([start, title], k) => {
    tests[title] = hash(lines.slice(start, starts[k + 1]?.[0] ?? lines.length).join('\n'));
  });
  return tests;
}

/* The ruling id a lock key names: `P2` for `P2 (owner, …): …`, `owner 2026-10-09` for an unnumbered ruling, else the key itself. */
const rulingId = key => /^(?:[A-Z]+\d+[a-z]?|owner \d{4}-\d{2}-\d{2})\b/.exec(key)?.[0] ?? key;

function diff(locked = {}, current = {}) {
  const changes = [];
  for (const [key, h] of Object.entries(current)) {
    if (!(key in locked)) {
      changes.push({ key, id: rulingId(key), what: 'added' });
    } else if (locked[key] !== h) {
      changes.push({ key, id: rulingId(key), what: 'edited' });
    }
  }
  for (const key of Object.keys(locked)) {
    if (!(key in current)) {
      changes.push({ key, id: rulingId(key), what: 'removed (or no longer owner-ruled)' });
    }
  }
  return changes;
}

export function compareRulingsLock() {
  const lockPath = join(root, LOCK);
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
  const current = { ledger: ownerRulingRows(), tests: rulingTests() };
  return {
    lock,
    current,
    ledger: diff(lock?.ledger, current.ledger),
    tests: diff(lock?.tests, current.tests)
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { current, ledger, tests } = compareRulingsLock();
  writeFileSync(
    join(root, LOCK),
    `${JSON.stringify({
      _: `OWNER-LOCKED. Content hashes of the owner-ruled rows of ${LEDGER} and of the tests in ${RULING_TESTS}. `
        + 'Regenerate with `pnpm rulings:lock` ONLY when the owner explicitly approved the change. See scripts/rulings-lock.mjs.',
      ledger: current.ledger,
      tests: current.tests
    }, null, 2)}\n`
  );
  console.log(`${LOCK}: ${Object.keys(current.ledger).length} owner-ruled ledger rows, ${Object.keys(current.tests).length - 1} conformance tests.`);
  if (ledger.length + tests.length === 0) {
    console.log('No owner ruling changed.');
  }
  for (const c of ledger) {
    console.log(`  OWNER RULING ${c.id}: ledger row ${c.what}`);
  }
  for (const c of tests) {
    console.log(`  OWNER RULING ${c.id}: conformance test ${c.what}${c.key === c.id ? '' : ` — ${c.key}`}`);
  }
}
