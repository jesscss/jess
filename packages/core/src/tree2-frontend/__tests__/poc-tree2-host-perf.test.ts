import { describe, it } from 'vitest';
import { parseLessFn, lessGrammar } from '@jesscss/less-parser';
import { runFunctionalParse } from '@jesscss/css-parser/jess';
import { bridgeToTree2 } from '../bridge.js';
import { PocTree2Host } from '../poc-tree2-host.js';

/**
 * [tree2-poc] Front-end cost: parse→tree2 DIRECT (one tree) vs the current
 * parse→legacy-tree→bridge (two trees + bridge walk), same grammar, same shape.
 * Warmup + median-of-N. Logs only (perf varies by machine); the null hypothesis
 * is DIRECT is faster because it deletes a whole legacy tree build + the bridge.
 */
const g = lessGrammar as Record<string, unknown>;

function makeSource(nRules: number): string {
  let s = '';
  for (let i = 0; i < nRules; i++) {
    s += `.cls-${i} { color: red; width: 10px; margin: 0; padding: 2px }\n`;
  }
  return s;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function timeIt(fn: () => void, iters: number, reps: number): number {
  // Warmup.
  for (let i = 0; i < 50; i++) fn();
  const samples: number[] = [];
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / iters / 1e6); // ms per op
  }
  return median(samples);
}

describe('[tree2-poc] front-end perf: direct vs legacy+bridge', () => {
  it('measure', () => {
    for (const nRules of [50, 200]) {
      const src = makeSource(nRules);
      const iters = 200;
      const reps = 15;

      const bridgePath = () => {
        const parsed = parseLessFn(src);
        bridgeToTree2(parsed.tree, src);
      };
      const directPath = () => {
        const host = new PocTree2Host();
        runFunctionalParse(src, g['Stylesheet'] as never, host as never, { trivia: g['rw'] });
      };
      // Also isolate the parse-only cost (shared by both) to attribute the delta.
      const parseOnly = () => { parseLessFn(src); };

      // Interleave to cancel drift.
      const legacyBridge = timeIt(bridgePath, iters, reps);
      const direct = timeIt(directPath, iters, reps);
      const parse = timeIt(parseOnly, iters, reps);

      const ratio = legacyBridge / direct;
      console.log(
        `\n[perf nRules=${nRules}]` +
        `\n  parse-only (legacy tree)     : ${parse.toFixed(4)} ms/op` +
        `\n  legacy tree + bridge (path A): ${legacyBridge.toFixed(4)} ms/op` +
        `\n  tree2 direct        (path B) : ${direct.toFixed(4)} ms/op` +
        `\n  speedup A/B                  : ${ratio.toFixed(3)}x` +
        `\n  bridge overhead (A - parse)  : ${(legacyBridge - parse).toFixed(4)} ms/op`
      );
    }
  }, 120000);
});
