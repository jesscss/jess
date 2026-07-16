import { describe, it } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { buildEvaluator } from '../value-eval.js';
import { renderRealOracle } from '../oracle.js';
import { withLegacyOpCounters } from '../../tree2-harness/shapes.js';

/**
 * R2 value-eval race — operations + functions, vs the REAL oracle.
 *
 * HONEST FRAMING (post-R2): value math is now tree2-NATIVE — operators delegate
 * to the shared value-node arithmetic and functions to `@jesscss/fns` invoked
 * DIRECTLY on typed operands (NO reparse, NO legacy render, NO record pre-pass).
 * So this is no longer an "equal cost both sides" race: the tree2 lane is the
 * FULL synchronous serialize INCLUDING the inline value evaluation, timed against
 * the full REAL oracle render. Straight numbers, no extrapolation, no hidden
 * precompute lane.
 */

const R = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';
const read = (p: string): string => fs.readFileSync(`${R}/${p}`, 'utf8');

const corpus: Array<[string, string]> = [
  ['color-functions/basic', read('color-functions/basic.less')],
  ['color-functions/formats', read('color-functions/formats.less')],
  ['color-functions/modern-syntax', read('color-functions/modern-syntax.less')],
];
const constructed: Array<[string, string]> = [
  ['fn-lighten', '.a { color: lighten(blue, 10%); }\n'],
  ['op-chain-color', '#o { color: (#110000 + #000011 + #001100); }\n'],
  ['fn-mix-heavy', Array.from({ length: 20 }, (_, i) => `.c${i} { color: mix(#ff0000, #0000ff, ${i * 5}%); }`).join('\n') + '\n'],
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

async function race(name: string, src: string): Promise<void> {
  const parsed = parseLessFn(src);
  const tree = parsed.tree;
  const t2 = (await serialize(bridgeToTree2(tree, src), { evaluator: buildEvaluator() })).css;
  const leg = await renderRealOracle(tree);
  const identical = t2 === leg;

  const WARM = 5;
  const N = 15;

  // tree2 lane: full synchronous serialize INCLUDING native value eval.
  for (let i = 0; i < WARM; i++) await serialize(bridgeToTree2(tree, src), { evaluator: buildEvaluator() });
  gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await serialize(bridgeToTree2(tree, src), { evaluator: buildEvaluator() });
    t2times.push(performance.now() - a);
  }
  const t2heap = (process.memoryUsage().heapUsed - m0) / N;

  // tree lane: full real-oracle render (math inline).
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
    `  ${name.padEnd(26)} id=${identical ? 'Y' : 'N'} ` +
      `t2 ${t2m.toFixed(4)}ms tree ${legm.toFixed(4)}ms (${(legm / t2m).toFixed(1)}x)  ` +
      `heap/rnd t2 ${(t2heap / 1024).toFixed(1)}KB tree ${(legheap / 1024).toFixed(1)}KB  ` +
      `ops t2[compose ${t2ops.composeOps}] tree[clone ${legops.cloneForPlacement}+inherit ${legops.inherit}+withComp ${legops.withComponents}]`,
  );
}

describe('tree2 bridge — value-eval race (R2: native operations + functions)', () => {
  it('race', async () => {
    console.log(`\n===== TREE2 vs TREE RACE — R2 native value-eval (gc=${gc ? 'on' : 'off'}) =====`);
    console.log('t2 = full sync serialize INCLUDING native value eval ; tree = full REAL oracle render (math inline)');
    console.log('-- real color-function corpus (byte-identical vs REAL oracle) --');
    for (const [n, s] of corpus) await race(n, s);
    console.log('-- constructed value-heavy --');
    for (const [n, s] of constructed) await race(n, s);
    console.log('=================================================================\n');
  }, 120000);
});
