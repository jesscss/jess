/**
 * Re-measure the sass-spec AST parse rate on a clean build, and emit a raw
 * per-case record for categorisation. No classification here: this file only
 * records what the shipping `parse()` did.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const pkg = resolve(repo, 'packages/syntax/scss/scss-parser');
const cache = resolve(pkg, '.cache/sass-spec');

const require_ = createRequire(resolve(pkg, 'noop.js'));
const parsemanEntry = require_.resolve('parseman');
const parsemanPkg = resolve(parsemanEntry.split('/node_modules/parseman/')[0], 'node_modules/parseman/package.json');

const { parse } = await import(resolve(pkg, 'lib/index.js'));
const { run } = await import(parsemanEntry.replace(/\.cjs$/, '.js'));
const { scssGrammar } = await import(resolve(pkg, 'lib/grammar/ast.js'));
const { commentTriviaLabels } = await import(resolve(pkg, 'lib/cst.js'));

const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));

const rows = [];
let ok = 0;
for (const c of manifest.cases) {
  const source = readFileSync(resolve(cache, c.inputRelPath), 'utf8');
  const row = {
    id: c.id,
    feature: c.feature,
    hrx: c.hrxRelPath,
    section: c.sectionPath,
    bytes: source.length
  };

  // Raw parseman run, so we can read `unconsumedFrom` / `span.end` directly and
  // never infer "passed" from `ok` alone.
  let raw;
  try {
    raw = run(
      scssGrammar.Stylesheet,
      source,
      { trivia: scssGrammar.whitespace, rootTrivia: { select: commentTriviaLabels } }
    );
    row.rawOk = raw.ok;
    row.spanEnd = raw.span?.end ?? null;
    row.unconsumedFrom = raw.unconsumedFrom;
    // The ONLY correct verdict: `ok` alone is true for 1467 non-consuming
    // parses, and `span.end === source.length` excludes trailing trivia and
    // disagrees on 488 entries. `parse-with.ts:60` uses exactly this pair.
    row.verdictOk = raw.ok && raw.unconsumedFrom === null;
    row.fullyConsumed = raw.ok && raw.unconsumedFrom === null && raw.span?.end === source.length;
    row.expected = raw.ok ? null : (raw.expected ?? []).slice(0, 12);
  } catch (e) {
    row.rawThrew = String(e && e.message ? e.message : e);
  }

  try {
    parse(source);
    row.astOk = true;
    ok++;
  } catch (e) {
    row.astOk = false;
    row.errName = e?.name ?? 'unknown';
    row.errMessage = String(e?.message ?? e).slice(0, 300);
    row.errOffset = typeof e?.offset === 'number' ? e.offset : null;
  }
  rows.push(row);
}

const mismatch = rows.filter(r => r.astOk !== r.fullyConsumed).length;
const okAlone = rows.filter(r => r.rawOk).length;
const verdict = rows.filter(r => r.verdictOk).length;
const verdictMismatch = rows.filter(r => r.astOk !== r.verdictOk).length;
console.error(`ok alone (WRONG):        ${okAlone}`);
console.error(`ok && unconsumed===null: ${verdict}`);
console.error(`verdict vs parse() mismatches: ${verdictMismatch}`);

console.error(`parseman: ${parsemanPkg}`);
console.error(`parseman version: ${JSON.parse(readFileSync(parsemanPkg, 'utf8')).version}`);
console.error(`corpus entries: ${rows.length}`);
console.error(`ast parse ok:   ${ok} (${((ok / rows.length) * 100).toFixed(1)}%)`);
console.error(`ast parse fail: ${rows.length - ok}`);
console.error(`span.end===source.length agreement mismatches: ${mismatch}`);

writeFileSync(resolve(here, 'rows.json'), JSON.stringify(rows, null, 1));
