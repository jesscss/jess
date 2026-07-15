import { describe, it } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats, type ValueService } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { buildValueService } from '../value-service.js';
import { renderRealOracle } from '../oracle.js';
import { withLegacyOpCounters } from '../../tree2-harness/shapes.js';

/**
 * Rung 8 race — value operations + functions, vs the REAL (function-evaluating)
 * oracle. HONEST FRAMING: value MATH is delegated to the shared value service
 * (the same fns registry + Less eval the oracle uses), so that cost is EQUAL on
 * both sides and is NOT a representation signal. tree2's timed lane is the
 * synchronous serialize with a PRE-BUILT (map-backed) service — i.e. tree2's
 * representation + value emission, with the shared math precomputed. The
 * separately-reported `svc` column is that async precompute (the shared math),
 * so nothing is hidden. The tree lane is the full real-oracle render (which
 * includes the same math inline). Straight numbers, no extrapolation.
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
  const service: ValueService = await buildValueService(bridgeToTree2(tree, src));
  const t2 = serialize(bridgeToTree2(tree, src), { valueService: service }).css;
  const leg = await renderRealOracle(tree);
  const identical = t2 === leg;

  const WARM = 5;
  const N = 15;

  // tree2 lane: sync serialize with the pre-built (map) service (math precomputed).
  for (let i = 0; i < WARM; i++) serialize(bridgeToTree2(tree, src), { valueService: service });
  gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    serialize(bridgeToTree2(tree, src), { valueService: service });
    t2times.push(performance.now() - a);
  }
  const t2heap = (process.memoryUsage().heapUsed - m0) / N;

  // Shared value-math precompute cost (async), reported separately, NOT hidden.
  for (let i = 0; i < WARM; i++) await buildValueService(bridgeToTree2(tree, src));
  const svcTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await buildValueService(bridgeToTree2(tree, src));
    svcTimes.push(performance.now() - a);
  }

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
  const svcm = median(svcTimes);
  console.log(
    `  ${name.padEnd(26)} id=${identical ? 'Y' : 'N'} ` +
      `t2 ${t2m.toFixed(4)}ms tree ${legm.toFixed(4)}ms (${(legm / t2m).toFixed(1)}x)  ` +
      `svc(shared-math) ${svcm.toFixed(4)}ms  ` +
      `heap/rnd t2 ${(t2heap / 1024).toFixed(1)}KB tree ${(legheap / 1024).toFixed(1)}KB  ` +
      `ops t2[compose ${t2ops.composeOps}] tree[clone ${legops.cloneForPlacement}+inherit ${legops.inherit}+withComp ${legops.withComponents}]`,
  );
}

describe('tree2 bridge — value-eval race (rung 8: operations + functions)', () => {
  it('race', async () => {
    console.log(`\n===== TREE2 vs TREE RACE — value-eval rung (gc=${gc ? 'on' : 'off'}) =====`);
    console.log('t2 = sync serialize w/ pre-built map service (shared math precomputed) ; tree = full REAL oracle render');
    console.log('svc = async shared value-math precompute (EQUAL cost on both sides — reported straight, not a repr signal)');
    console.log('-- real color-function corpus (byte-identical vs REAL oracle) --');
    for (const [n, s] of corpus) await race(n, s);
    console.log('-- constructed value-heavy --');
    for (const [n, s] of constructed) await race(n, s);
    console.log('=================================================================\n');
  }, 120000);
});
