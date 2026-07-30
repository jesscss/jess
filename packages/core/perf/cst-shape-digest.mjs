/*
 * Canonical CST digest across all four dialects, for same-worktree git-toggle
 * A/B of `buildCssCstNode`.
 *
 * All four dialects route their CST through the SAME `buildCssCstNode`, so a
 * change there has a four-dialect blast radius and must be proven on all four.
 *
 * Emits a stable digest capturing everything the builder controls:
 *   - node `type` / `grammarType` / `tags` / `span` / `state` / arity
 *   - the node's KEY ORDER (a conditional spread is exactly the construct that
 *     could silently reorder fields, so key order is part of the contract)
 *   - leaf `value` / `span`
 *   - the parse `ok` flag and the selected root-trivia rows
 *
 * Do NOT JSON.stringify these trees: `rules` and `children` are the SAME array
 * under two names, so a naive serializer duplicates every subtree at every
 * level and exhausts the heap.
 *
 * Usage: node packages/core/perf/cst-shape-digest.mjs > before.txt
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const R = new URL('../../../', import.meta.url).pathname;

const { parseCssCst } = await import(`${R}packages/syntax/css/css-parser/lib/cst.js`);
const { parseLessCst } = await import(`${R}packages/syntax/less/less-parser/lib/cst.js`);
const { parseScssCst } = await import(`${R}packages/syntax/scss/scss-parser/lib/cst.js`);
const { parseJessCst } = await import(`${R}packages/syntax/jess/jess-parser/lib/cst.js`);

const FIXTURES = [
  ['css', parseCssCst, `${R}packages/jess/benchmark/benchmark.css`],
  ['less', parseLessCst, `${R}packages/jess/benchmark/benchmark.less`],
  ['jess', parseJessCst, `${R}packages/jess/benchmark/benchmark.jess`],
  /* scss has no benchmark fixture; exercise the shared builder on CSS bytes,
   * which every dialect must accept (valid CSS is valid in all dialects). */
  ['scss', parseScssCst, `${R}packages/jess/benchmark/benchmark.css`],
  ['less-on-css', parseLessCst, `${R}packages/jess/benchmark/benchmark.css`],
  ['jess-on-css', parseJessCst, `${R}packages/jess/benchmark/benchmark.css`]
];

function digest(label, parse, file) {
  if (!existsSync(file)) { return `${label}\tSKIP (no ${file})`; }
  const src = readFileSync(file, 'utf8');
  const r = parse(src);
  const h = createHash('sha256');
  let nodes = 0, leaves = 0, errors = 0, tagged = 0, aliased = 0;
  const keyOrders = new Set();

  /* Explicit stack, DFS, deterministic child order. */
  const stack = [r.tree];
  while (stack.length) {
    const n = stack.pop();
    if (n._tag === 'node') {
      nodes++;
      if (n.tags !== undefined) { tagged++; }
      if (n.rules === n.children) { aliased++; }
      const keys = Object.keys(n).join(',');
      keyOrders.add(keys);
      h.update(`N|${keys}|${n.type}|${n.grammarType}|${String(n.tags)}|${n.span.start}|${n.span.end}|${String(n.span.startLine)}|${String(n.span.startColumn)}|${String(n.span.endLine)}|${String(n.span.endColumn)}|${String(n.state)}|${n.rules.length}\n`);
      for (let i = n.rules.length - 1; i >= 0; i--) { stack.push(n.rules[i]); }
    } else if (n._tag === 'leaf') {
      leaves++;
      h.update(`L|${n.value}|${n.span.start}|${n.span.end}\n`);
    } else {
      errors++;
      h.update(`E|${n.type}|${n.span.start}|${n.span.end}|${n.expected.join('/')}\n`);
      for (let i = n.rules.length - 1; i >= 0; i--) { stack.push(n.rules[i]); }
    }
  }
  h.update(`TRIVIA|${(r.rootTrivia?.rows ?? []).join(',')}\n`);
  h.update(`OK|${r.ok}|UNCONSUMED|${String(r.unconsumedFrom)}\n`);

  return [
    `${label}\tsha=${h.digest('hex').slice(0, 16)}`,
    `ok=${r.ok}`,
    `nodes=${nodes}`,
    `leaves=${leaves}`,
    `errors=${errors}`,
    `tagged=${tagged}`,
    `aliased=${aliased}`,
    `trivia=${(r.rootTrivia?.rows ?? []).length}`,
    `keyOrders=${[...keyOrders].map(k => `{${k}}`).join(' ')}`
  ].join('\t');
}

for (const [label, parse, file] of FIXTURES) {
  console.log(digest(label, parse, file));
}
