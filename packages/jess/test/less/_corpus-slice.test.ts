/**
 * Child worker for the full-corpus completeness report (see
 * scripts/less-corpus-report.mjs). Runs under `vitest` so it gets the TS transform
 * for the src path (`../../src/index.js`). Two modes, selected by env:
 *
 *   CORPUS_MODE=discover  → enumerate every case in the corpus and write the
 *                           job list to CORPUS_JOBS_OUT (no rendering — cheap,
 *                           no OOM risk).
 *   CORPUS_MODE=render    → read a slice of jobs from CORPUS_SLICE_FILE, render/
 *                           classify each, and APPEND one JSONL result line per
 *                           job to CORPUS_RESULT_FILE, flushing after each so a
 *                           SIGKILL'd child pinpoints the exact culprit (the
 *                           first job with no result line) for the parent.
 *
 * Inert (skipped) when CORPUS_MODE is unset, so a normal `vitest run` ignores it.
 */
import { describe, expect, it } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync, appendFileSync, writeFileSync } from 'fs';
import { Compiler } from '../../src/index.js';
import { getTestCases, resolveLessTestDataRoot, lessFixturePackagesPlugin, lessHarnessFunctionsPlugin } from '../test-utils.js';
import type { TestCase } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import type { StylesConfig } from 'styles-config';

const MODE = process.env.CORPUS_MODE;
const testData = resolveLessTestDataRoot();
const rel = (p: string) => path.relative(testData, p).split(path.sep).join('/');

// Sync infinite-loopers block the event loop; the parent's SIGKILL still reaps
// them, but skipping the known ones avoids a slow per-fixture kill cycle.
const KNOWN_HANG = new Set<string>([
  'tests-unit/variables/variable-advanced.less',
  'tests-unit/merge/merge.less',
  'tests-unit/selectors/selectors.less',
  'tests-unit/extend-exact/extend-exact.less'
]);

const PER_FIXTURE_TIMEOUT_MS = 8000;

interface Job { kind: 'render' | 'error'; file: string; lessPath: string; expectedFile?: string; config?: Partial<StylesConfig> }

const baseCompiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] }),

      /*
       * Pins bare-specifier third-party `@import`s (tests-config/3rd-party/bootstrap4.less)
       * — see lessFixturePackagesPlugin.
       */
      lessFixturePackagesPlugin()
    ]
  }
});

function makeTestCompiler(config: Partial<StylesConfig> = {}) {
  const { plugins: testCasePlugins = [], ...restCompile } = config.compile ?? {};
  return new Compiler({
    ...baseCompiler.opts,
    ...config,
    compile: {
      ...(baseCompiler.opts.compile || {}),
      ...restCompile,
      plugins: [...(baseCompiler.opts.compile?.plugins || []), ...testCasePlugins]
    },
    output: { ...baseCompiler.opts.output, ...(config?.output || {}) }
  });
}

function firstLine(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error);
  return message.split('\n')[0]!;
}

async function withTimeout<T>(work: () => Promise<T>, timeoutMs = PER_FIXTURE_TIMEOUT_MS) {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<'__t__'>((r) => {
    timer = setTimeout(() => r('__t__'), timeoutMs);
  });
  try {
    const res = await Promise.race([work().then(v => ({ v }), e => ({ e })), t]);
    if (res === '__t__') {
      return { timedOut: true } as const;
    }
    if ('e' in res) {
      return { error: res.e } as const;
    }
    return { value: res.v } as const;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function classifyRenderResult(result: { css: string; errors: readonly unknown[] }, expectedCss: string) {
  const firstError = result.errors[0];
  if (firstError) {
    return { outcome: 'error' as const, detail: firstLine(firstError) };
  }
  return { outcome: result.css === expectedCss ? 'pass' as const : 'mismatch' as const };
}

function discover(): Job[] {
  const jobs: Job[] = [];
  const renderFiles = [
    ...glob.sync(path.join(testData, 'tests-unit/**/*.less')),
    ...glob.sync(path.join(testData, 'tests-config/**/*.less')),
    ...glob.sync(path.join(testData, 'plugin/**/*.less'))
  ].filter(f => !KNOWN_HANG.has(rel(f)));
  for (const lessPath of renderFiles) {
    let cases: TestCase[];
    try {
      cases = getTestCases(lessPath);
    } catch {
      continue; // no expected output → import-target/helper
    }
    const file = rel(lessPath);
    cases.forEach((tc, i) => {
      jobs.push({
        kind: 'render',
        file: cases.length > 1 ? `${file} [${i + 1}/${cases.length}]` : file,
        lessPath,
        expectedFile: tc.expectedFile,
        config: tc.config
      });
    });
  }
  glob.sync(path.join(testData, 'tests-error/**/*.less'))
    .filter(f => !KNOWN_HANG.has(rel(f)))
    .forEach(lessPath => jobs.push({ kind: 'error', file: rel(lessPath), lessPath }));
  return jobs;
}

async function runJob(job: Job): Promise<{ file: string; kind: string; outcome: string; detail?: string }> {
  if (job.kind === 'error') {
    const res = await withTimeout(() => makeTestCompiler({}).renderToResult(job.lessPath, { breakOnError: true }));
    if ('timedOut' in res) {
      return { file: job.file, kind: 'error', outcome: 'timeout' };
    }
    if ('error' in res) {
      return { file: job.file, kind: 'error', outcome: 'errored', detail: firstLine(res.error) };
    }
    const r = res.value;
    const errored = Array.isArray(r?.errors) && r.errors.length > 0;
    return { file: job.file, kind: 'error', outcome: errored ? 'errored' : 'accepted', detail: errored ? firstLine(r.errors[0]?.message ?? r.errors[0]) : undefined };
  }
  const res = await withTimeout(async () => {
    const r = await makeTestCompiler(job.config).renderToResult(job.lessPath, { outputFile: job.expectedFile });
    return classifyRenderResult(r, readFileSync(job.expectedFile!, 'utf8'));
  });
  if ('timedOut' in res) {
    return { file: job.file, kind: 'render', outcome: 'timeout' };
  }
  if ('error' in res) {
    return { file: job.file, kind: 'render', outcome: 'error', detail: firstLine(res.error) };
  }
  return { file: job.file, kind: 'render', ...res.value };
}

describe('corpus render diagnostic classification', () => {
  it('records a returned compiler diagnostic as an error, not a CSS mismatch', () => {
    expect(classifyRenderResult({ css: 'a{}', errors: [new Error('unsupported plugin ABI')] }, 'a{}')).toEqual({
      outcome: 'error',
      detail: 'unsupported plugin ABI'
    });
  });
});

(MODE ? describe : describe.skip)('corpus slice worker', () => {
  it('runs the assigned slice', async () => {
    if (MODE === 'discover') {
      writeFileSync(process.env.CORPUS_JOBS_OUT!, JSON.stringify(discover()), 'utf8');
      return;
    }
    const slice: Job[] = JSON.parse(readFileSync(process.env.CORPUS_SLICE_FILE!, 'utf8'));
    const out = process.env.CORPUS_RESULT_FILE!;
    for (const job of slice) {
      const result = await runJob(job);
      appendFileSync(out, JSON.stringify(result) + '\n');
    }
  }, 24 * 60 * 60 * 1000);
});
