import { describe, it } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { buildEvaluator } from '../value-eval.js';
import { renderRealOracle } from './oracle.js';
import { withLegacyOpCounters } from './harness/shapes.js';

/**
 * Guards / pattern / named-param race, vs the REAL oracle. HONEST FRAMING
 * (same as the rung-8 value race): guard-LEAF truth (comparisons / type-check
 * functions) is delegated to the shared value service — the SAME Less guard
 * evaluator the oracle uses — so that cost is EQUAL on both sides and is NOT a
 * representation signal (reported straight in the `svc` column). tree2's timed
 * lane is the synchronous serialize with a pre-built map service: representation
 * + overload dispatch (arity/pattern/named/guard STRUCTURE), with the shared
 * guard/value math precomputed. The tree lane is the full real-oracle render.
 *
 * The point of interest: tree2's OVERLOAD DISPATCH (selecting + expanding the
 * matching definitions) must stay clone/inherit/withComponents-FREE — its
 * structural op columns must be ZERO while legacy pays them per placement.
 */

const constructed: Array<[string, string]> = [
  // 40 guarded calls across a 3-overload comparison mixin (pos/neg/zero).
  [
    'guard-cmp-40',
    '.sign(@n) when (@n > 0) { s: pos; }\n.sign(@n) when (@n < 0) { s: neg; }\n.sign(@n) when (@n = 0) { s: zero; }\n' +
      Array.from({ length: 40 }, (_, i) => `.c${i} { .sign(${i - 20}); }`).join('\n') +
      '\n',
  ],
  // 30 pattern-dispatch calls (literal keyword match across 3 overloads).
  [
    'pattern-30',
    '.icon(add) { d: "+"; }\n.icon(sub) { d: "-"; }\n.icon(mul) { d: "*"; }\n' +
      Array.from({ length: 30 }, (_, i) => `.i${i} { .icon(${['add', 'sub', 'mul'][i % 3]}); }`).join('\n') +
      '\n',
  ],
  // 30 default-param calls (some omitted, some named, some positional).
  [
    'named-default-30',
    '.pad(@t: 1px; @b: 2px; @l: 3px) { top: @t; bottom: @b; left: @l; }\n' +
      Array.from({ length: 30 }, (_, i) =>
        i % 3 === 0
          ? `.p${i} { .pad(); }`
          : i % 3 === 1
            ? `.p${i} { .pad(${i}px); }`
            : `.p${i} { .pad(@b: ${i}px); }`,
      ).join('\n') +
      '\n',
  ],
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
  const t2 = (await serialize(bridgeToAst(tree, src), { evaluator })).css;
  const leg = await renderRealOracle(tree);
  const identical = t2 === leg;

  const WARM = 5;
  const N = 15;

  for (let i = 0; i < WARM; i++) await serialize(bridgeToAst(tree, src), { evaluator });
  gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await serialize(bridgeToAst(tree, src), { evaluator });
    t2times.push(performance.now() - a);
  }
  const t2heap = (process.memoryUsage().heapUsed - m0) / N;

  for (let i = 0; i < WARM; i++) buildEvaluator();
  const svcTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    buildEvaluator();
    svcTimes.push(performance.now() - a);
  }

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

  // Pass the service so guarded fixtures count the compositions they produce.
  const t2ops = composeStats(bridgeToAst(tree, src), evaluator);
  const legops = await withLegacyOpCounters(async () => {
    await renderRealOracle(parseLessFn(src).tree);
  });

  const t2m = median(t2times);
  const legm = median(legtimes);
  const svcm = median(svcTimes);
  console.log(
    `  ${name.padEnd(18)} id=${identical ? 'Y' : 'N'} ` +
      `t2 ${t2m.toFixed(4)}ms tree ${legm.toFixed(4)}ms (${(legm / t2m).toFixed(1)}x)  ` +
      `svc(shared) ${svcm.toFixed(4)}ms  ` +
      `heap/rnd t2 ${(t2heap / 1024).toFixed(1)}KB tree ${(legheap / 1024).toFixed(1)}KB  ` +
      `ops t2[compose ${t2ops.composeOps}] tree[clone ${legops.cloneForPlacement}+inherit ${legops.inherit}+withComp ${legops.withComponents}]`,
  );
}

describe('tree2 bridge — guards/pattern race', () => {
  it('race', async () => {
    console.log(`\n===== TREE2 vs TREE RACE — guards/pattern rung (gc=${gc ? 'on' : 'off'}) =====`);
    console.log('t2 = sync serialize w/ pre-built map service (overload dispatch; shared guard/value math precomputed)');
    console.log('svc = async shared guard/value precompute (EQUAL cost both sides — not a repr signal)');
    console.log('KEY: tree2 dispatch must keep clone/inherit/withComp structurally ZERO.');
    for (const [n, s] of constructed) await race(n, s);
    console.log('=================================================================\n');
  }, 120000);
});
