import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize, composeStats } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { createImportState } from '../import-bridge.js';
import { withLegacyOpCounters } from '../../tree2-harness/shapes.js';
import { renderImportOracle } from './import-oracle.js';

const ROOT = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';

// t2 lane = parse-main(excluded) + bridge(RESOLVE+INLINE imports: read+parse+
// bridge each imported file) + serialize. tree lane = the full legacy import
// pipeline (jess Compiler with the Less plugin: parse + resolve + eval + emit),
// which is the only faithful import oracle. Both byte-identical. Straight
// numbers, no extrapolation.
const FIXTURES = [
  'import/import/import-test-f.less',
  'import/import/import-test-b.less',
  'import/import-once.less',
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
const gc: (() => void) | undefined = (globalThis as { gc?: () => void }).gc;

async function race(rel: string): Promise<void> {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, 'utf8');
  const mainTree = parseLessFn(src).tree;

  const t2css = serialize(bridgeToTree2(mainTree, src, file, createImportState())).css;
  const oracle = await renderImportOracle(file);
  expect(t2css).toBe(oracle);

  const WARM = 5;
  const N = 15;

  for (let i = 0; i < WARM; i++) serialize(bridgeToTree2(mainTree, src, file, createImportState()));
  gc?.();
  const m0 = process.memoryUsage().heapUsed;
  const t2times: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    serialize(bridgeToTree2(mainTree, src, file, createImportState()));
    t2times.push(performance.now() - a);
  }
  const t2heap = (process.memoryUsage().heapUsed - m0) / N;

  for (let i = 0; i < WARM; i++) await renderImportOracle(file);
  gc?.();
  const l0 = process.memoryUsage().heapUsed;
  const legtimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = performance.now();
    await renderImportOracle(file);
    legtimes.push(performance.now() - a);
  }
  const legheap = (process.memoryUsage().heapUsed - l0) / N;

  const t2ops = composeStats(bridgeToTree2(mainTree, src, file, createImportState()));
  const legops = await withLegacyOpCounters(async () => {
    await renderImportOracle(file);
  });

  const t2m = median(t2times);
  const legm = median(legtimes);
  console.log(
    `  ${rel.replace('import/import/', '').replace('import/', '').padEnd(20)} ` +
      `t2 ${t2m.toFixed(4)}ms tree ${legm.toFixed(4)}ms (${(legm / t2m).toFixed(1)}x)  ` +
      `heap/rnd t2 ${(t2heap / 1024).toFixed(1)}KB tree ${(legheap / 1024).toFixed(1)}KB  ` +
      `ops t2[compose ${t2ops.composeOps}, clone 0, inherit 0] ` +
      `tree[clone ${legops.cloneForPlacement}+inherit ${legops.inherit}+withComp ${legops.withComponents}]`,
  );
}

describe('tree2 @import — real-fixture race', () => {
  it('race', async () => {
    console.log(`\n===== TREE2 vs TREE RACE — @import rung (gc=${gc ? 'on' : 'off'}) =====`);
    console.log('t2 = bridge(resolve+inline)+serialize ; tree = jess Compiler full import pipeline ; all byte-identical');
    for (const rel of FIXTURES) await race(rel);
    console.log('=================================================================\n');
  }, 120000);
});
