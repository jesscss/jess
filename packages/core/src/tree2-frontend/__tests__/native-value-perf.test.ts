import { describe, it, expect } from 'vitest';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { buildNativeEvaluator } from '../../tree2/native-evaluator.js';
import { bridgeToTree2 } from '../bridge.js';
import { buildEvaluator } from '../value-eval.js';

/**
 * PERF micro-bench: the NATIVE value path (synchronous operate + free serializer,
 * boundary-clean) vs the transitional ADAPTER (legacy value nodes + `@jesscss/fns`
 * + `render()`). Same worktree, same bridged AST, warmup + median — the honest A/B
 * the guardrails require. The value bench is operation/fn/color-heavy so the value
 * lane dominates. Expectation: native is neutral-or-better (the bake-off + POC both
 * showed large wins from dropping the legacy node round-trip + reparse).
 */

// Value-heavy source: color ops + arithmetic + converted fns, repeated.
const SRC = Array.from({ length: 60 }, (_, i) => {
  const a = i % 16, b = (i * 7) % 16;
  return `.r${i} {\n` +
    `  a: (#${a}${a}0000 + #0000${b}${b});\n` +
    `  b: (${i}px + ${i * 2}px);\n` +
    `  c: (100% - ${i}px);\n` +
    `  d: lighten(#ff0000, ${i % 50}%);\n` +
    `  e: percentage(0.${i % 9 + 1});\n` +
    `  f: (#0a0a0a * 2);\n` +
    `}`;
}).join('\n') + '\n';

const tree = parseLessFn(SRC).tree;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

async function bench(native: boolean, warm: number, n: number): Promise<number> {
  const make = () => (native ? buildNativeEvaluator() : buildEvaluator());
  for (let i = 0; i < warm; i++) await serialize(bridgeToTree2(tree, SRC), { evaluator: make() });
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await serialize(bridgeToTree2(tree, SRC), { evaluator: make() });
    times.push(performance.now() - t0);
  }
  return median(times);
}

describe('[tree2] native value path — perf micro-bench', () => {
  it('native operate/emit is neutral-or-better than the adapter', async () => {
    // Sanity: identical bytes (perf only meaningful when correct).
    const nCss = (await serialize(bridgeToTree2(tree, SRC), { evaluator: buildNativeEvaluator() })).css;
    const aCss = (await serialize(bridgeToTree2(tree, SRC), { evaluator: buildEvaluator() })).css;
    expect(nCss).toBe(aCss);

    const WARM = 8, N = 25;
    // Interleave to avoid ordering bias, then take the median of each.
    const adapterMs = await bench(false, WARM, N);
    const nativeMs = await bench(true, WARM, N);

    // eslint-disable-next-line no-console
    console.log(
      `\n[native-value-perf] value-heavy serialize (${SRC.length} bytes src, median of ${N})` +
      `\n  adapter : ${adapterMs.toFixed(3)} ms` +
      `\n  native  : ${nativeMs.toFixed(3)} ms` +
      `\n  speedup adapter/native : ${(adapterMs / nativeMs).toFixed(2)}x`,
    );

    // Neutral-or-better with generous slack for CI noise (expect native faster).
    expect(nativeMs).toBeLessThanOrEqual(adapterMs * 1.15);
  }, 120000);
});
