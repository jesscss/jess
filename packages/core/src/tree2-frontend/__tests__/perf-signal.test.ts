/**
 * PERF SIGNAL harness (directional, NOT the definitive benchmark).
 *
 * Times three engines on the SAME real `.less` input, source -> CSS:
 *   - tree2      : parseLessFn -> bridgeToTree2 -> serialize   (the cleanroom rewrite)
 *   - jess-cur   : the jess Compiler + less plugin (== less.js v5 `alpha`)
 *   - less-4x    : the ONE independent engine (old Less.js 4.6.7)
 *
 * Byte-identity is asserted between tree2 and jess-current (the v5 correctness
 * oracle) before any timing is trusted. Less 4.x emits DIFFERENT bytes (flat /
 * expanded); that is expected — the comparison is "same input, how long to
 * render", not identical output.
 *
 * Protocol: warmup >= 12, N = 25 median, gc between samples when exposed.
 * This is a DIRECTIONAL number on small real fixtures, not the 131578-byte
 * benchmark.less. Run with:
 *   NODE_OPTIONS=--expose-gc pnpm test tree2-frontend/__tests__/perf-signal
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { parseLessFn } from '@jesscss/less-parser';
import { serialize } from '../../tree2/index.js';
import { bridgeToTree2 } from '../bridge.js';
import { createImportState } from '../import-bridge.js';
import { buildEvaluator } from '../value-eval.js';
import { renderImportOracle } from './import-oracle.js';

const require = createRequire(import.meta.url);
// Independent Less 4.x engine (scratch install) + read-only fixture corpus. Both
// are machine-local absolute paths (see header); this directional harness SKIPS
// itself cleanly when either is absent, so it never red-fails a generic checkout.
const LESS_4X_PATH = '/private/tmp/less4x-scratch/node_modules/less';
const LESS_ROOT = '/Users/matthew/git/worktrees/less.js/packages/test-data/tests-unit';
const ENV_OK = fs.existsSync(LESS_4X_PATH) && fs.existsSync(LESS_ROOT);
const less4x = ENV_OK ? require(LESS_4X_PATH) : null;

// The most substantial CLEAN-PASS fixtures from the census (largest / most eval
// work). All render byte-identical to jess-current (asserted below).
const FIXTURES = [
  'merge/merge.less',
  'extend-chaining/extend-chaining.less',
  'mixins-pattern/mixins-pattern.less',
  'color-functions/comprehensive.less',
  'namespace-targeted/namespace-targeted.less',
];

/** tree2: full source -> CSS (parse + bridge + serialize). */
async function tree2Full(src: string, file: string): Promise<string> {
  const parsed = parseLessFn(src);
  const root = bridgeToTree2(parsed.tree, src, file, createImportState());
  const evaluator = buildEvaluator();
  return (await serialize(root, { evaluator, collapseNesting: true })).css;
}

/** tree2: render only (bridge + serialize), parse excluded — pre-parse once. */
function makeTree2RenderOnly(src: string, file: string): () => Promise<string> {
  const parsed = parseLessFn(src);
  return async () => {
    const root = bridgeToTree2(parsed.tree, src, file, createImportState());
    const evaluator = buildEvaluator();
    return (await serialize(root, { evaluator, collapseNesting: true })).css;
  };
}

/** jess-current: Compiler + less plugin (== v5 alpha), source -> CSS. */
async function jessCurrent(file: string): Promise<string> {
  return await renderImportOracle(file);
}

/** Less 4.x: source -> CSS (different bytes, timing only). */
async function less4xRender(src: string, file: string): Promise<string> {
  const res = await less4x.render(src, {
    filename: file,
    paths: [path.dirname(file)],
  });
  return res.css;
}

interface Stat {
  median: number;
  min: number;
  p25: number;
}

async function timeIt(fn: () => Promise<unknown>, warmup: number, n: number): Promise<Stat> {
  for (let i = 0; i < warmup; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    globalThis.gc?.();
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  return { median, min: samples[0], p25: samples[Math.floor(samples.length * 0.25)] };
}

const fmt = (n: number): string => n.toFixed(4).padStart(9);

describe.skipIf(!ENV_OK)('tree2 perf signal — three-way median on real fixtures', () => {
  it('measures tree2 vs jess-current vs Less 4.x', async () => {
    const WARMUP = 12;
    const N = 25;
    const gcOn = typeof globalThis.gc === 'function';
    const rows: string[] = [];
    rows.push(`gc exposed: ${gcOn}  |  warmup=${WARMUP}  N=${N} (median)`);
    rows.push('');
    rows.push(
      'fixture'.padEnd(34) +
        'bytes'.padStart(7) +
        '  ' +
        'tree2ms'.padStart(9) +
        '  ' +
        'tree2-noParse'.padStart(13) +
        '  ' +
        'jessMs'.padStart(9) +
        '  ' +
        'less4xMs'.padStart(9) +
        '  ' +
        'jess/4x'.padStart(8) +
        '  ' +
        't2/4x'.padStart(7),
    );

    let sumT2 = 0;
    let sumJess = 0;
    let sumLess = 0;

    for (const rel of FIXTURES) {
      const file = path.join(LESS_ROOT, rel);
      const src = fs.readFileSync(file, 'utf8');

      // Byte-identity: tree2 MUST equal jess-current (the v5 oracle).
      const t2css = await tree2Full(src, file);
      const jessCss = await jessCurrent(file);
      expect(t2css, `${rel}: tree2 must be byte-identical to jess-current`).toBe(jessCss);
      const outBytes = t2css.length;

      const renderOnly = makeTree2RenderOnly(src, file);

      const st2 = await timeIt(() => tree2Full(src, file), WARMUP, N);
      const st2ro = await timeIt(renderOnly, WARMUP, N);
      const sjess = await timeIt(() => jessCurrent(file), WARMUP, N);
      const sless = await timeIt(() => less4xRender(src, file), WARMUP, N);

      sumT2 += st2.median;
      sumJess += sjess.median;
      sumLess += sless.median;

      rows.push(
        rel.padEnd(34) +
          String(src.length).padStart(7) +
          '  ' +
          fmt(st2.median) +
          '  ' +
          fmt(st2ro.median) +
          '  ' +
          fmt(sjess.median) +
          '  ' +
          fmt(sless.median) +
          '  ' +
          (sjess.median / sless.median).toFixed(2).padStart(8) +
          '  ' +
          (st2.median / sless.median).toFixed(2).padStart(7) +
          `  (out ${outBytes}B)`,
      );
    }

    rows.push('');
    rows.push(
      `SUM medians  tree2=${sumT2.toFixed(3)}ms  jess=${sumJess.toFixed(3)}ms  less4x=${sumLess.toFixed(3)}ms`,
    );
    rows.push(
      `RATIOS vs Less 4.x:  jess-current = ${(sumJess / sumLess).toFixed(2)}x   tree2 = ${(sumT2 / sumLess).toFixed(2)}x`,
    );
    rows.push(`tree2 speedup over jess-current = ${(sumJess / sumT2).toFixed(2)}x`);

    // eslint-disable-next-line no-console
    console.log('\n============ TREE2 PERF SIGNAL ============\n' + rows.join('\n') + '\n==========================================\n');
  }, 120000);

  // STAGE 2 — a bigger real file: the clean-passing fixtures concatenated. Gated
  // on byte-identity to jess-current; if the concat diverges (cross-block lazy-var
  // or extend interaction) the whole block is skipped and Stage 1 stands alone.
  it('STAGE 2 — bigger concatenated real file', async () => {
    const file = path.resolve(__dirname, '../../../perf-stage2-concat.less');
    const src = fs.readFileSync(file, 'utf8');

    const t2css = await tree2Full(src, file);
    const jessCss = await jessCurrent(file);
    const identical = t2css === jessCss;

    if (!identical) {
      // Find first divergence for the report, then bail (Stage 1 is the number).
      let i = 0;
      while (i < t2css.length && i < jessCss.length && t2css[i] === jessCss[i]) i++;
      // eslint-disable-next-line no-console
      console.log(
        `\n[STAGE 2] concat NOT byte-identical (${src.length}B in). First diff at byte ${i}.\n` +
          `  tree2: ${JSON.stringify(t2css.slice(Math.max(0, i - 30), i + 30))}\n` +
          `  jess : ${JSON.stringify(jessCss.slice(Math.max(0, i - 30), i + 30))}\n` +
          `  => dropping Stage 2, Stage 1 stands.\n`,
      );
      return;
    }

    const WARMUP = 12;
    const N = 25;
    const renderOnly = makeTree2RenderOnly(src, file);
    const st2 = await timeIt(() => tree2Full(src, file), WARMUP, N);
    const st2ro = await timeIt(renderOnly, WARMUP, N);
    const sjess = await timeIt(() => jessCurrent(file), WARMUP, N);
    const sless = await timeIt(() => less4xRender(src, file), WARMUP, N);

    // eslint-disable-next-line no-console
    console.log(
      '\n============ STAGE 2 (bigger concat) ============\n' +
        `input=${src.length}B  output=${t2css.length}B  byte-identical tree2==jess: YES\n` +
        `tree2      median = ${fmt(st2.median)} ms  (min ${fmt(st2.min)})\n` +
        `tree2-noParse median= ${fmt(st2ro.median)} ms\n` +
        `jess-cur   median = ${fmt(sjess.median)} ms  (min ${fmt(sjess.min)})\n` +
        `less-4x    median = ${fmt(sless.median)} ms  (min ${fmt(sless.min)})\n` +
        `RATIOS vs Less 4.x:  jess = ${(sjess.median / sless.median).toFixed(2)}x   tree2 = ${(st2.median / sless.median).toFixed(2)}x\n` +
        `tree2 speedup over jess = ${(sjess.median / st2.median).toFixed(2)}x\n` +
        '=================================================\n',
    );
  }, 120000);
});
