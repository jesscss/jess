import { describe, it } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../index.js';
import { bridgeToAst } from './bridge.js';
import { Context } from '../../../context.js';
import { renderNodeToString } from '../../../tree/util/render-buffer.js';

const CN = { collapseNesting: true } as const;

async function renderLegacy(tree: unknown): Promise<string> {
  const ctx = new Context();
  (ctx as unknown as { root: unknown }).root = tree;
  return await renderNodeToString(tree as Parameters<typeof renderNodeToString>[0], ctx, CN);
}

const R = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';
const read = (p: string): string => fs.readFileSync(`${R}/${p}`, 'utf8');

// Newly-passing REAL variable fixtures — byte-identical to the tree
// oracle and genuinely exercising variable resolution — plus a rung-6 static
// baseline, plus constructed variable-heavy real-syntax inputs (parsed +
// bridged through the real front end) to exercise deeper scope chains.
const corpus: Array<[string, string]> = [
  ['lazy-eval.less', read('lazy-eval/lazy-eval.less')],
  ['import-test-c.less', read('import/import/import-test-c.less')],
  ['logo.less (static)', read('import/import/imports/logo.less')],
];
const constructed: Array<[string, string]> = [
  ['var-chain-deep', '@a: 1px; @b: @a; @c: @b; @d: @c;\n.x { width: @d; }\n'],
  ['var-scope-nested', '@c: red;\n.a { @c: blue; .b { color: @c; } color: @c; }\n'],
  ['var-mixin-arg-scope', '.paint(@c) { color: @c; border-color: @c; }\n@x: teal;\n.a { .paint(@x); }\n.b { .paint(gold); }\n'],
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

async function race(name: string, src: string): Promise<void> {
  const parsed = parseLessFn(src);
  const tree = parsed.tree;
  const t2 = serialize(bridgeToAst(tree, src)).css;
  const leg = await renderLegacy(tree);
  const identical = t2 === leg;

  const WARM = 5;
  const N = 15;

  for (let i = 0; i < WARM; i++) serialize(bridgeToAst(tree, src));
  gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    serialize(bridgeToAst(tree, src));
    t2times.push(performance.now() - a);
  }
  const t2heap = (process.memoryUsage().heapUsed - m0) / N;

  for (let i = 0; i < WARM; i++) await renderLegacy(tree);
  gc?.();
  const l0 = process.memoryUsage().heapUsed;
  const legtimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await renderLegacy(tree);
    legtimes.push(performance.now() - a);
  }
  const legheap = (process.memoryUsage().heapUsed - l0) / N;

  const t2m = median(t2times);
  const legm = median(legtimes);
  console.log(
    `  ${name.padEnd(22)} id=${identical ? 'Y' : 'N'} ` +
      `t2 ${t2m.toFixed(4)}ms tree ${legm.toFixed(4)}ms (${(legm / t2m).toFixed(1)}x)  ` +
      `heap/rnd t2 ${(t2heap / 1024).toFixed(1)}KB tree ${(legheap / 1024).toFixed(1)}KB`
  );
}

describe('tree2 bridge — real-fixture race', () => {
  it('race', async () => {
    console.log(`\n===== TREE2 vs TREE RACE — variables rung (gc=${gc ? 'on' : 'off'}) =====`);
    console.log('t2 = build-from-parse(bridge)+serialize ; tree = full legacy render ; parse excluded');
    console.log('-- newly-passing real corpus (variable + static) --');
    for (const [n, s] of corpus) await race(n, s);
    console.log('-- constructed variable-heavy real-syntax --');
    for (const [n, s] of constructed) await race(n, s);
    console.log('=================================================================\n');
  }, 120000);
});
