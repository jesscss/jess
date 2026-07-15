import { describe, it } from 'vitest';
import * as fs from 'fs';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../../tree/util/render-buffer.js';

const CN = { collapseNesting: true } as const;

async function renderLegacy(tree: unknown): Promise<string> {
  const ctx = new Context();
  (ctx as unknown as { root: unknown }).root = tree;
  return await renderNodeToString(tree as Parameters<typeof renderNodeToString>[0], ctx, CN);
}

const R = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';

// Real corpus clean-passers that EMIT non-empty output (the meaningful races),
// plus a couple of constructed real-syntax nesting/mixin inputs (parsed + bridged
// through the real front end) to exercise the composition cost center that the
// static corpus fixtures don't reach.
const corpus: Array<[string, string]> = [
  ['logo.less', fs.readFileSync(`${R}/import/import/imports/logo.less`, 'utf8')],
  ['simple-ruleset-2162.less', fs.readFileSync(`${R}/import/import-reference-issues/simple-ruleset-2162.less`, 'utf8')],
  ['global-scope-nested.less', fs.readFileSync(`${R}/import/import-reference-issues/global-scope-nested.less`, 'utf8')],
];
const constructed: Array<[string, string]> = [
  ['nesting-3deep', '.a { .b { .c { color: red; width: 1px; } } }\n'],
  ['mixin-call-nested', '.box() { color: red; .inner { width: 1px; } &:hover { color: blue; } }\n.a { .box(); }\n.b { .box(); }\n'],
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

async function race(name: string, src: string): Promise<void> {
  const parsed = parseLessFn(src);
  const parsedTree = parsed.tree;
  // Verify byte-identity first (gate).
  const t2 = serialize(bridgeToTree2(parsedTree, src)).css;
  const leg = await renderLegacy(parsedTree);
  const identical = t2 === leg;

  const WARM = 5;
  const N = 15;

  // tree2 lane: build-from-parse (bridge) + serialize.
  for (let i = 0; i < WARM; i++) serialize(bridgeToTree2(parsedTree, src));
  gc?.();
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    serialize(bridgeToTree2(parsedTree, src));
    t2times.push(performance.now() - a);
  }

  // tree lane: full legacy render (async eval+emit). Fresh Context each call.
  for (let i = 0; i < WARM; i++) await renderLegacy(parsedTree);
  gc?.();
  const legtimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await renderLegacy(parsedTree);
    legtimes.push(performance.now() - a);
  }

  const t2m = median(t2times);
  const legm = median(legtimes);
  console.log(
    `  ${name.padEnd(26)} identical=${identical ? 'YES' : 'NO '}  ` +
      `tree2 ${t2m.toFixed(4)}ms  tree ${legm.toFixed(4)}ms  ` +
      `speedup ${(legm / t2m).toFixed(1)}x  outBytes=${t2.length}`,
  );
}

describe('tree2 bridge — real-fixture race', () => {
  it('race', async () => {
    console.log(`\n============ TREE2 vs TREE — REAL-FIXTURE RACE (gc=${gc ? 'on' : 'off'}) ============`);
    console.log('build-from-parse+serialize (tree2) vs full render (tree); parse shared/excluded');
    console.log('-- real corpus fixtures --');
    for (const [n, s] of corpus) await race(n, s);
    console.log('-- constructed real-syntax (parsed+bridged through real front end) --');
    for (const [n, s] of constructed) await race(n, s);
    console.log('=================================================================\n');
  }, 120000);
});
