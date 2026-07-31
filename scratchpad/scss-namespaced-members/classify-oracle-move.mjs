/**
 * Classify every entry the SCSS byte-identity oracle reports as MOVED.
 *
 * The deliverable of this lane WIDENS the accepted language, so movement is
 * expected — but only on inputs that were REJECTED before. An entry that already
 * parsed and now digests differently is a regression, and `ast aggregate moved`
 * alone cannot tell the two apart. This does.
 *
 * `pre` parse status comes from the pre-change `rows.json` written by
 * scratchpad/sass-spec-triage/measure.mjs; `post` status is probed live.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const pkg = resolve(repo, 'packages/syntax/scss/scss-parser');
const cache = resolve(pkg, '.cache/sass-spec');

const baseline = JSON.parse(readFileSync(resolve(pkg, 'test/oracle-byte-identity.baseline.json'), 'utf8'));
const post = JSON.parse(readFileSync(resolve(here, 'post-report.json'), 'utf8'));

const rows = JSON.parse(readFileSync(resolve(repo, 'scratchpad/sass-spec-triage/rows.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const pathById = new Map(manifest.cases.map(c => [c.id, c.inputRelPath]));

/** corpus-relative path -> pre-change parse verdict (ok && unconsumedFrom===null) */
const preOk = new Map();
for (const r of rows) {
  const rel = pathById.get(r.id);
  if (rel !== undefined) {
    preOk.set(`packages/syntax/scss/scss-parser/.cache/sass-spec/${rel}`, r.astOk);
  }
}

const { parse } = await import(resolve(pkg, 'lib/index.js'));

const moved = { ast: [], cst: [] };
for (const [entry, digests] of Object.entries(post.perEntry)) {
  const before = baseline.perEntry[entry];
  if (before === undefined) {
    moved.ast.push({ entry, kind: 'new-corpus-entry' });
    continue;
  }
  for (const surface of ['ast', 'cst']) {
    if (before[surface] !== digests[surface]) {
      moved[surface].push(entry);
    }
  }
}

const summary = {};
for (const surface of ['ast', 'cst']) {
  const buckets = { newlyAccepted: 0, regressed: [], unknownPre: [] };
  for (const entry of moved[surface]) {
    const pre = preOk.get(entry);
    if (pre === undefined) {
      buckets.unknownPre.push(entry);
      continue;
    }
    if (pre === false) {
      buckets.newlyAccepted += 1;
    } else {
      buckets.regressed.push(entry);
    }
  }
  summary[surface] = {
    moved: moved[surface].length,
    newlyAccepted: buckets.newlyAccepted,
    regressed: buckets.regressed.length,
    regressedEntries: buckets.regressed.slice(0, 40),
    unknownPre: buckets.unknownPre.length,
    unknownPreEntries: buckets.unknownPre.slice(0, 40)
  };
}

/* Newly accepted overall (independent of digest movement). */
let nowOk = 0;
let wasOk = 0;
for (const [entry, pre] of preOk) {
  if (pre) wasOk += 1;
  try {
    parse(readFileSync(resolve(repo, entry), 'utf8'));
    nowOk += 1;
  } catch { /* still rejected */ }
}

console.log(JSON.stringify({ ...summary, sassSpec: { wasOk, nowOk, total: preOk.size } }, null, 1));
writeFileSync(resolve(here, 'oracle-move-classification.json'), JSON.stringify({ summary, moved }, null, 1));
