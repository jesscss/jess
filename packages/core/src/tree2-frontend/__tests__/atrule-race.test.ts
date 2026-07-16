import { describe, it } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { buildEvaluator } from '../value-eval.js';
import { renderRealOracle } from '../oracle.js';
import { withLegacyOpCounters } from '../../tree2-harness/shapes.js';

/**
 * Rung 9 at-rule race — tree2 (bridge + sync serialize with pre-built value
 * service) vs the legacy tree (full REAL oracle render). Same worktree, warmup
 * 3, N=9 median, `--expose-gc`. Straight numbers, no extrapolation. The key
 * structural signal is the op-count columns: tree2's clone/inherit/withComponents
 * analog is ZERO by construction (it has no such op), including inside at-rule
 * bodies where nested rulesets compose via one interned string each.
 */

const R = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';
const read = (p: string): string => fs.readFileSync(`${R}/${p}`, 'utf8');

const corpus: Array<[string, string]> = [
  ['at-rules-declarations', read('at-rules-declarations/at-rules-declarations.less')],
  ['at-rules-empty-block', read('at-rules-empty-block/at-rules-empty-block.less')],
  ['import/imports/font', read('import/import/imports/font.less')],
];

// Constructed at-rule-heavy inputs (nested rulesets inside blocks = compositions).
const mediaHeavy =
  Array.from({ length: 200 }, (_, i) => `@media print { .a${i} { .b${i} { color: red; } } }`).join('\n') + '\n';
const keyframesHeavy =
  Array.from({ length: 200 }, (_, i) => `@keyframes k${i} { from { opacity: 0; } to { opacity: 1; } }`).join('\n') + '\n';
const constructed: Array<[string, string]> = [
  ['media-heavy(200 x nested)', mediaHeavy],
  ['keyframes-heavy(200)', keyframesHeavy],
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

async function race(name: string, src: string): Promise<void> {
  const parsed = parseLessFn(src);
  const tree = parsed.tree;
  const evaluator = buildEvaluator();
  const t2 = (await serialize(bridgeToTree2(tree, src), { evaluator })).css;
  const leg = await renderRealOracle(tree);
  const identical = t2 === leg;

  const WARM = 3;
  const N = 9;

  for (let i = 0; i < WARM; i++) await serialize(bridgeToTree2(tree, src), { evaluator });
  gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await serialize(bridgeToTree2(tree, src), { evaluator });
    t2times.push(performance.now() - a);
  }
  const t2heap = (process.memoryUsage().heapUsed - m0) / N;

  for (let i = 0; i < WARM; i++) await renderRealOracle(parseLessFn(src).tree);
  gc?.();
  const l0 = process.memoryUsage().heapUsed;
  const legtimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await renderRealOracle(parseLessFn(src).tree);
    legtimes.push(performance.now() - a);
  }
  const legheap = (process.memoryUsage().heapUsed - l0) / N;

  const t2ops = composeStats(bridgeToTree2(tree, src));
  const legops = await withLegacyOpCounters(async () => {
    await renderRealOracle(parseLessFn(src).tree);
  });

  const t2m = median(t2times);
  const legm = median(legtimes);
  console.log(
    `  ${name.padEnd(28)} id=${identical ? 'Y' : 'N'} ` +
      `t2 ${t2m.toFixed(4)}ms tree ${legm.toFixed(4)}ms (${(legm / t2m).toFixed(1)}x)  ` +
      `heap/rnd t2 ${(t2heap / 1024).toFixed(1)}KB tree ${(legheap / 1024).toFixed(1)}KB  ` +
      `ops t2[compose ${t2ops.composeOps}] tree[clone ${legops.cloneForPlacement}+inherit ${legops.inherit}+withComp ${legops.withComponents}]`,
  );
}

describe('tree2 bridge — at-rule race (rung 9)', () => {
  it('race', async () => {
    console.log(`\n===== TREE2 vs TREE RACE — at-rule rung (gc=${gc ? 'on' : 'off'}) =====`);
    console.log('t2 = bridge + sync serialize (w/ pre-built value service) ; tree = full REAL oracle render');
    console.log('-- real less.js at-rule fixtures (byte-identical) --');
    for (const [n, s] of corpus) await race(n, s);
    console.log('-- constructed at-rule-heavy --');
    for (const [n, s] of constructed) await race(n, s);
    console.log('=================================================================\n');
  }, 120000);
});
