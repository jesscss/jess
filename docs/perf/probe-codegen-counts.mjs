/**
 * PROBE — not a proposed change.
 *
 * Counts codegen features in the SHIPPED macro-compiled artifact, per host-mode
 * grammar, by slicing the generated file at its four grammar boundaries.
 * Pure static counting: no timing, no noise floor.
 *
 * Features counted (see parseman dist/index.cjs emitNode, ~line 9057):
 *   _ngc                      first-set guard sites (emitted only when
 *                             `capturesChildren || structural`)
 *   Object.assign({}, _ctx.state)   per-node state clone sites (clonesState)
 *   _EMPTY_TL                 nodes with trivia capture ELIDED
 *   _dcst                     nodes where children or raw capture is elided in
 *                             AST mode (direct-CST gate var is only emitted
 *                             when !cstMode && (!capturesChildren || !capturesRaw))
 *
 *   node docs/perf/probe-codegen-counts.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const TARGETS = [
  ['css', 'packages/syntax/css/css-parser/lib/'],
  ['less', 'packages/syntax/less/less-parser/lib/'],
  ['scss', 'packages/syntax/scss/scss-parser/lib/'],
  ['jess', 'packages/syntax/jess/jess-parser/lib/']
];

const FEATURES = [
  // NB (grammar-static-complexity lane): the original `/\b_ngc\d*\s*=/` also
  // matched the `_ngcN === 32` comparisons the guard condition expands into,
  // roughly doubling the count (css reported 74/77; the real site counts are
  // 20/21). Match the declaration only.
  ['firstSetGuard', /const _ngc\d+ = _pos < input\.length/g],
  ['stateClone', /Object\.assign\(\{\}, _ctx\.state\)/g],
  ['triviaElided', /_EMPTY_TL/g],
  ['captureElided', /\b_dcst\d*\s*=/g],
  ['buildCall', /_build\[\d+\]\(/g],
  ['hostCall', /_ctx\.build\(/g],
  ['inlineMk', /_tag: 'node', type: /g]
];

function count(src, re) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(src) !== null) n++;
  return n;
}

for (const [dialect, rel] of TARGETS) {
  let src;
  for (const f of ['grammar2.js', 'grammar.js']) {
    try {
      const s = readFileSync(resolve(repo, rel, f), 'utf8');
      if (new RegExp(`^const ${dialect}Grammar =`, 'm').test(s)) { src = s; break; }
    } catch { /* try next */ }
  }
  if (src === undefined) {
    console.log(`\n=== ${dialect}: no generated artifact found under ${rel} ===`);
    continue;
  }
  const boundRe = new RegExp(`^const (${dialect}Grammar|${dialect}PositionsGrammar|${dialect}CstGrammar|${dialect}CstPositionsGrammar) =`, 'gm');
  const bounds = [];
  let m;
  while ((m = boundRe.exec(src)) !== null) bounds.push([m[1], m.index]);
  bounds.push(['<end>', src.length]);

  console.log(`\n=== ${dialect} — ${(src.length / 1e6).toFixed(2)} MB generated ===`);
  const rows = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const [name, start] = bounds[i];
    const slice = src.slice(start, bounds[i + 1][1]);
    const row = { name, kb: Math.round(slice.length / 1024) };
    for (const [f, re] of FEATURES) row[f] = count(slice, re);
    rows.push(row);
  }
  const cols = ['name', 'kb', ...FEATURES.map(f => f[0])];
  console.log('  ' + cols.map(c => c.padEnd(c === 'name' ? 26 : 14)).join(''));
  for (const r of rows) {
    console.log('  ' + cols.map(c => String(r[c]).padEnd(c === 'name' ? 26 : 14)).join(''));
  }
  const ast = rows.find(r => r.name === `${dialect}Grammar`);
  const cst = rows.find(r => r.name === `${dialect}CstGrammar`);
  if (ast && cst) {
    console.log(`  -> first-set guards: ast=${ast.firstSetGuard} cst=${cst.firstSetGuard} (ast/cst=${(ast.firstSetGuard / cst.firstSetGuard).toFixed(3)})`);
    console.log(`  -> state clones:     ast=${ast.stateClone} cst=${cst.stateClone}`);
  }
}
