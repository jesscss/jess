/**
 * Evidence-based residual ranking: cluster the 777 remaining failures by the
 * text the parser actually STOPPED on, not by a hand-written gap regex.
 *
 * The regex attribution ranks by "earliest known gap at or after the failure
 * offset", which mis-ranks whenever two gaps co-occur and the wrong one is
 * textually first (this lane hit exactly that: `meta.inspect(map.deep-merge(
 * $map1: …))` attributes to the namespace gap although the namespace form now
 * parses and the blocker is the named argument). Clustering on the failure
 * offset itself has no such ordering assumption.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const cache = resolve(repo, 'packages/syntax/scss/scss-parser/.cache/sass-spec');
const rows = JSON.parse(readFileSync(resolve(repo, 'scratchpad/sass-spec-triage/rows.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const pathById = new Map(manifest.cases.map(c => [c.id, c.inputRelPath]));

const buckets = new Map();
const samples = new Map();

for (const r of rows) {
  if (r.astOk) continue;
  const source = readFileSync(resolve(cache, pathById.get(r.id)), 'utf8');
  const at = typeof r.errOffset === 'number' ? r.errOffset : 0;
  const head = source.slice(at, at + 48).replace(/\n/g, '\\n');
  /* Normalise identifiers/numbers so `color.mix(` and `list.join(` cluster. */
  const key = head
    .replace(/[a-zA-Z_][-\w]*/g, 'I')
    .replace(/\d+/g, 'N')
    .slice(0, 14);
  buckets.set(key, (buckets.get(key) ?? 0) + 1);
  if (!samples.has(key)) samples.set(key, []);
  if (samples.get(key).length < 3) samples.get(key).push({ hrx: r.hrx, at, head });
}

const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log(`residual failures: ${rows.filter(r => !r.astOk).length}\n`);
for (const [key, n] of ranked) {
  console.log(`${String(n).padStart(4)}  ${JSON.stringify(key)}`);
  for (const s of samples.get(key)) console.log(`        @${s.at} ${s.hrx}  ${JSON.stringify(s.head)}`);
}
writeFileSync(resolve(here, 'residual-clusters.json'), JSON.stringify([...buckets], null, 1));
