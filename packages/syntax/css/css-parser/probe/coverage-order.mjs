/**
 * Orders the remaining coverage gaps by how many corpus ENTRIES each one
 * blocks, so the work is sequenced by what actually moves `--min-real` rather
 * than by what feels foundational.
 *
 * Counts entries, not occurrences: one file using `calc()` two hundred times is
 * still one tree that either parses or does not. A gap present in a 1-entry
 * root is worth less than one present in 200, however central it looks.
 */
import { loadCssCorpus } from '../../../../../tools/grammar-tournament/src/corpus.mjs';

/* Each probe is deliberately over-broad: a false positive costs a rule I was */
/* going to write anyway, a false negative silently under-orders the work.    */
const GAPS = [
  ['conditional preludes (@media/@container/@supports)', /@(?:media|container|supports)\b/i],
  ['calc() and friends', /\b(?:calc|min|max|clamp)\s*\(/i],
  ['var() fallbacks', /var\s*\(\s*--[^,)]*,/],
  ['@page and margin at-rules', /@(?:page|top-|bottom-|left-|right-)/i],
  ['@keyframes', /@(?:-[a-z]+-)?keyframes\b/i],
  ['@font-feature-values', /@(?:font-feature-values|stylistic|styleset|swash|ornaments|annotation)\b/i],
  ['@import tail (media/layer/supports)', /@import\b[^;]*[^;"']\s*(?:layer|supports|screen|print|all|\()/i],
  [':nth-* families', /:nth-(?:child|last-child|of-type|last-of-type)\s*\(/i],
  ['@layer', /@layer\b/i],
  ['@scope', /@scope\b/i],
  ['@font-face / descriptor at-rules', /@(?:font-face|counter-style|property|color-profile|position-try|view-transition)\b/i],
  ['attribute selectors', /\[[-\w]+\s*[~^|$*]?=/],
  ['functional pseudos (:is/:where/:not/:has)', /:(?:is|where|not|has)\s*\(/i],
  ['unicode-range', /\bU\+[0-9A-Fa-f?]/],
  ['!important', /!\s*important/i]
];

const corpus = loadCssCorpus(new URL('../../../../../', import.meta.url).pathname);
const entries = corpus.ids.map(id => ({ id, source: corpus.read(id) }));
const total = entries.length;

const rows = GAPS.map(([name, probe]) => {
  const hits = entries.filter(entry => probe.test(entry.source ?? entry.text ?? '')).length;
  return [name, hits];
});

rows.sort((a, b) => b[1] - a[1]);

console.log(`corpus entries: ${total}`);
console.log('');
console.log('gap                                             entries   % of corpus');
for (const [name, hits] of rows) {
  console.log(
    name.padEnd(48),
    String(hits).padStart(6),
    `${(hits / total * 100).toFixed(1)}%`.padStart(12)
  );
}
