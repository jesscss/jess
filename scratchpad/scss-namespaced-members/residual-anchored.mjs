/**
 * Offset-ANCHORED attribution: what does the parser stop ON?
 *
 * The regex attribution ranks by "earliest known gap at or AFTER the failure
 * offset", which over-counts any gap whose pattern happens to appear textually
 * before the real blocker. Anchoring at the offset removes that bias, at the
 * cost of only covering gaps whose syntax IS at the stop point.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const cache = resolve(repo, 'packages/syntax/scss/scss-parser/.cache/sass-spec');
const rows = JSON.parse(readFileSync(resolve(repo, 'scratchpad/sass-spec-triage/rows.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(cache, 'manifest.json'), 'utf8'));
const pathById = new Map(manifest.cases.map(c => [c.id, c.inputRelPath]));

const ANCHORED = [
  ['value-position namespaced member (THIS LANE)', /^[a-zA-Z_][\w-]*\.(?:[a-zA-Z_][\w-]*\(|\$)/],
  ['named / spread call argument', /^\$[-\w]+\s*(?::|\.\.\.)/],
  ['CSS if() arm separator', /^[:;]/],
  ['@use/@forward modifier (with/show/hide/as *)', /^(?:with\s*\(|show\b|hide\b|as\b)/],
  ['@include ns. / using / content block', /^(?:@include\b|using\b|\{)/],
  ['namespaced variable assignment', /^[a-zA-Z_][\w-]*\.\$[-\w]+\s*:/],
  /* Comment-as-trivia: a separate lane owns the css fix; counted, not fixed. */
  ['comment within 24 chars of the stop point', /^[\s\S]{0,24}?(?:\/\*|\/\/)/],
  ['@content', /^@content\b/],
  ['@debug / @warn / @error', /^@(?:debug|warn|error)\b/],
  ['@at-root prelude', /^@at-root\b/],
  ['@import tail', /^@import\b/],
  ['@extend', /^@extend\b/],
  ['@while', /^@while\b/],
  ['value-position comparison  $a == (…)', /^==|^!=/]
];

const counts = new Map();
const samples = new Map();
for (const r of rows) {
  if (r.astOk) continue;
  const source = readFileSync(resolve(cache, pathById.get(r.id)), 'utf8');
  const at = typeof r.errOffset === 'number' ? r.errOffset : 0;
  const tail = source.slice(at);
  const hit = ANCHORED.find(([, re]) => re.test(tail));
  const name = hit ? hit[0] : 'other';
  counts.set(name, (counts.get(name) ?? 0) + 1);
  if (!samples.has(name)) samples.set(name, []);
  if (samples.get(name).length < 3) samples.get(name).push(`${r.hrx} @${at} ${JSON.stringify(tail.slice(0, 60))}`);
}

for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(4)}  ${name}`);
  for (const s of samples.get(name)) console.log(`        ${s}`);
}
