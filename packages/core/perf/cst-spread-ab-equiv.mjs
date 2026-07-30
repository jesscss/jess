/*
 * Prove the patched lane builds a structurally IDENTICAL tree to the base.
 *
 * NOTE: do NOT JSON.stringify these trees -- `rules` and `children` are the SAME
 * array under two names, so a naive serializer duplicates every subtree at every
 * level and blows the heap. Compare by direct parallel walk instead.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const dir = process.env.AB_DIR ?? '/tmp/jess-cst-spread-ab';
const base = await import(pathToFileURL(`${dir}/base/cst.js`).href);
const patched = await import(pathToFileURL(`${dir}/patched/cst.js`).href);
const src = readFileSync('/Users/matthew/git/oss/jess/packages/jess/benchmark/benchmark.css', 'utf8');

const a = base.parseCssCst(src);
const b = patched.parseCssCst(src);

let nodes = 0, leaves = 0, diffs = 0, orderDiffs = 0, aliasOk = 0;
const note = m => { if (diffs < 10) { console.log(`  DIFF: ${m}`); } diffs++; };

const stack = [[a.tree, b.tree]];
while (stack.length) {
  const [x, y] = stack.pop();
  if (x._tag !== y._tag) { note(`_tag ${x._tag} vs ${y._tag}`); continue; }
  /* Field ORDER is part of the shape a spread could change -- check it, not
   * just the value set. */
  const kx = Object.keys(x).join(',');
  const ky = Object.keys(y).join(',');
  if (kx !== ky) { orderDiffs++; if (orderDiffs <= 5) { console.log(`  KEY-ORDER: [${kx}] vs [${ky}]`); } }

  if (x._tag === 'node') {
    nodes++;
    if (x.type !== y.type) { note(`type ${x.type}/${y.type}`); }
    if (x.grammarType !== y.grammarType) { note(`grammarType ${x.grammarType}/${y.grammarType}`); }
    if (x.span.start !== y.span.start || x.span.end !== y.span.end) { note(`span`); }
    if (x.state !== y.state) { note(`state`); }
    if (String(x.tags) !== String(y.tags)) { note(`tags ${x.tags}/${y.tags}`); }
    if (x.rules === x.children && y.rules === y.children) { aliasOk++; }
    if (x.rules.length !== y.rules.length) { note(`arity ${x.rules.length}/${y.rules.length}`); continue; }
    for (let i = 0; i < x.rules.length; i++) { stack.push([x.rules[i], y.rules[i]]); }
  } else if (x._tag === 'leaf') {
    leaves++;
    if (x.value !== y.value || x.span.start !== y.span.start || x.span.end !== y.span.end) { note(`leaf ${x.value}/${y.value}`); }
  }
}

console.log(`ok flags     : base=${a.ok} patched=${b.ok}`);
console.log(`walked       : ${nodes.toLocaleString()} nodes, ${leaves.toLocaleString()} leaves`);
console.log(`value diffs  : ${diffs}`);
console.log(`key-order    : ${orderDiffs} differing (0 = patch preserves field order exactly)`);
console.log(`rules===children on both sides: ${aliasOk.toLocaleString()} / ${nodes.toLocaleString()} nodes`);
console.log(`triviaLog    : ${a.triviaLog.length === b.triviaLog.length && a.triviaLog.every((v, i) => v === b.triviaLog[i]) ? 'IDENTICAL' : 'DIFFERENT'} (${a.triviaLog.length.toLocaleString()} entries)`);
console.log(`RESULT       : ${diffs === 0 && orderDiffs === 0 ? 'EQUIVALENT' : 'NOT equivalent'}`);
