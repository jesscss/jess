import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { spineRenderCounter, Rules } from '@jesscss/core';

function makeExtendHeavy(nBases: number, nExtendersEach: number): string {
  const lines: string[] = [];
  for (let b = 0; b < nBases; b++) {
    lines.push(`.base${b} { color: rgb(${b % 256}, 0, 0); padding: ${b}px; margin: ${b}px; }`);
    for (let e = 0; e < nExtendersEach; e++) {
      lines.push(`.ext${b}_${e}:extend(.base${b}) { border: ${e}px solid; }`);
    }
  }
  return lines.join('\n');
}
// Extend-free but same rule count as an extend-heavy(60,4)=300 rules.
function makeExtendFree(nRules: number): string {
  const lines: string[] = [];
  for (let i = 0; i < nRules; i++) {
    lines.push(`.rule${i} { color: rgb(${i % 256}, 0, 0); padding: ${i}px; margin: ${i}px; border: 1px solid; }`);
  }
  return lines.join('\n');
}

const forceEvalPlugin = { name: 'force-eval', install() {}, preRenderVisitor: { isPreEvalVisitor: false, run: (r: any) => r } } as any;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const render = async (src: string, extra: any[]): Promise<string> => {
  const c = new Compiler({ output: { collapseNesting: true }, compile: { plugins: [lessPlugin(), lessCompatPlugin({}), ...extra] } });
  return c.renderString(src, { language: 'less' });
};

const orig = Rules.prototype.derive;
const route = async (src: string, extra: any[]) => {
  let derives = 0;
  Rules.prototype.derive = function (this: Rules, ...a: any[]) {
    derives++;
    return orig.apply(this, a as any);
  } as any;
  const before = spineRenderCounter.rootRenders;
  const css = await render(src, extra);
  Rules.prototype.derive = orig;
  return { spineMoved: spineRenderCounter.rootRenders > before, derives, css };
};

const bench = async (label: string, src: string) => {
  const iters = 25, warmup = 6;
  const s = await route(src, []);
  const e = await route(src, [forceEvalPlugin]);
  const time = async (extra: any[]): Promise<number[]> => {
    for (let i = 0; i < warmup; i++) await render(src, extra);
    const samples: number[] = [];
    for (let i = 0; i < iters; i++) {
      const t0 = performance.now();
      await render(src, extra);
      samples.push(performance.now() - t0);
    }
    return samples;
  };
  const sm = median(await time([]));
  const em = median(await time([forceEvalPlugin]));
  console.log(
    `PERF\t${label}\tspine[moved=${s.spineMoved},der=${s.derives}] eval[moved=${e.spineMoved},der=${e.derives}] byteEq=${s.css === e.css}\tSPINE=${sm.toFixed(1)}ms EVAL=${em.toFixed(1)}ms speedup=${(em / sm).toFixed(2)}x`
  );
};

describe('extend perf A/B (spine vs eval)', () => {
  it('scenarios', async () => {
    await bench('extend-heavy(60,4)=240ext', makeExtendHeavy(60, 4));
    await bench('extend-light(20,2)=40ext', makeExtendHeavy(20, 2));
    await bench('extend-free(300 rules)', makeExtendFree(300));
    expect(true).toBe(true);
  }, 300000);
});
