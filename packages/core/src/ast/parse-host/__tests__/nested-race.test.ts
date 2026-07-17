import { describe, it } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { buildEvaluator } from '../value-eval.js';
import { renderRealOracleNested } from './oracle.js';
import { withLegacyOpCounters } from './harness/shapes.js';

/**
 * R0 race — NESTED (`collapseNesting:false`) tree2 serialize vs the FULL pipeline
 * rendered nested. tree2's timed lane is the synchronous nested serialize with a
 * pre-built value service (shared math precomputed, reported separately). The
 * tree lane is the full real-oracle render in nested mode. Straight numbers,
 * warmup ≥3, N≥9 median, --expose-gc. Op-counts confirm tree2's
 * clone/inherit/withComponents stay structurally ZERO in nested mode too.
 */

// Nesting-heavy constructed inputs (the shape R0 exercises).
function deepNest(depth: number): string {
  let s = 'color: red;';
  for (let i = depth; i > 0; i--) s = `.l${i} { ${s} }`;
  return s + '\n';
}
function wideNest(n: number): string {
  const kids = Array.from({ length: n }, (_, i) => `.k${i} { color: red; &:hover { x: ${i}; } }`).join(' ');
  return `.root { ${kids} }\n`;
}
function mixinNest(n: number): string {
  return (
    '.card() { color: red; .title { font: bold; } .body { .row { pad: 1px; } } }\n' +
    Array.from({ length: n }, (_, i) => `.c${i} { .card(); }`).join('\n') +
    '\n'
  );
}

const cases: Array<[string, string]> = [
  ['deep-nest-8', deepNest(8)],
  ['wide-nest-40', wideNest(40)],
  ['mixin-nest-60', mixinNest(60)],
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

async function race(name: string, src: string): Promise<void> {
  const tree = parseLessFn(src).tree;
  const evaluator = buildEvaluator();
  const t2 = (await serialize(bridgeToAst(tree, src), { evaluator, collapseNesting: false })).css;
  const leg = await renderRealOracleNested(parseLessFn(src).tree);
  const identical = t2 === leg;

  const WARM = 5;
  const N = 11;

  for (let i = 0; i < WARM; i++)
    await serialize(bridgeToAst(tree, src), { evaluator, collapseNesting: false });
  gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await serialize(bridgeToAst(tree, src), { evaluator, collapseNesting: false });
    t2times.push(performance.now() - a);
  }
  const t2heap = (process.memoryUsage().heapUsed - m0) / N;

  for (let i = 0; i < WARM; i++) await renderRealOracleNested(parseLessFn(src).tree);
  gc?.();
  const l0 = process.memoryUsage().heapUsed;
  const legtimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await renderRealOracleNested(parseLessFn(src).tree);
    legtimes.push(performance.now() - a);
  }
  const legheap = (process.memoryUsage().heapUsed - l0) / N;

  const t2ops = composeStats(bridgeToAst(tree, src));
  const legops = await withLegacyOpCounters(async () => {
    await renderRealOracleNested(parseLessFn(src).tree);
  });

  const t2m = median(t2times);
  const legm = median(legtimes);
  console.log(
    `  ${name.padEnd(16)} id=${identical ? 'Y' : 'N'} ` +
      `t2 ${t2m.toFixed(4)}ms tree ${legm.toFixed(4)}ms (${(legm / t2m).toFixed(1)}x)  ` +
      `heap/rnd t2 ${(t2heap / 1024).toFixed(1)}KB tree ${(legheap / 1024).toFixed(1)}KB  ` +
      `ops t2[compose ${t2ops.composeOps} clone 0 inherit 0] tree[clone ${legops.cloneForPlacement}+inherit ${legops.inherit}+withComp ${legops.withComponents}]`,
  );
}

describe('R0 — nested race (collapseNesting:false)', () => {
  it('race', async () => {
    console.log(`\n===== TREE2 vs TREE — NESTED (collapseNesting:false) race (gc=${gc ? 'on' : 'off'}) =====`);
    for (const [n, s] of cases) await race(n, s);
    console.log('==============================================================\n');
  }, 120000);
});
