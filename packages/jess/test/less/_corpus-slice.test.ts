/**
 * Child worker for the full-corpus completeness report (see
 * scripts/less-corpus-report.mjs). Runs under `vitest` so it gets the working
 * TS/src transform (the built lib can't parse — parseman version skew). Two
 * modes, selected by env:
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
import { describe, it } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync, appendFileSync, writeFileSync } from 'fs';
import { Compiler } from '../../src/index.js';
import { getTestCases, resolveLessTestDataRoot, lessHarnessFunctionsPlugin } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

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

interface Job { kind: 'render' | 'error'; file: string; lessPath: string; expectedFile?: string; config?: any }

const baseCompiler = new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin(), lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] })] }
});

function makeTestCompiler(config: any) {
  const cc = (config?.compile || {}) as Record<string, any>;
  const { plugins: testCasePlugins = [], ...restCompile } = cc;
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

const firstLine = (e: any) => String(e?.message ?? e).split('\n')[0];

async function withTimeout<T>(work: () => Promise<T>) {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<'__t__'>(r => { timer = setTimeout(() => r('__t__'), PER_FIXTURE_TIMEOUT_MS); });
  try {
    const res = await Promise.race([work().then(v => ({ v }), e => ({ e })), t]);
    if (res === '__t__') return { timedOut: true } as const;
    if ('e' in res) return { error: res.e } as const;
    return { value: res.v } as const;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function discover(): Job[] {
  const jobs: Job[] = [];
  const renderFiles = [
    ...glob.sync(path.join(testData, 'tests-unit/**/*.less')),
    ...glob.sync(path.join(testData, 'tests-config/**/*.less')),
    ...glob.sync(path.join(testData, 'plugin/**/*.less'))
  ].filter(f => !KNOWN_HANG.has(rel(f)));
  for (const lessPath of renderFiles) {
    let cases;
    try {
      cases = getTestCases(lessPath);
    } catch {
      continue; // no expected output → import-target/helper
    }
    const file = rel(lessPath);
    cases.forEach((tc: any, i: number) => {
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
    const res = await withTimeout(() => makeTestCompiler({}).renderToResult(job.lessPath, { breakOnError: true } as any));
    if ('timedOut' in res) return { file: job.file, kind: 'error', outcome: 'timeout' };
    if ('error' in res) return { file: job.file, kind: 'error', outcome: 'errored', detail: firstLine(res.error) };
    const r: any = res.value;
    const errored = Array.isArray(r?.errors) && r.errors.length > 0;
    return { file: job.file, kind: 'error', outcome: errored ? 'errored' : 'accepted', detail: errored ? firstLine(r.errors[0]?.message ?? r.errors[0]) : undefined };
  }
  const res = await withTimeout(async () => {
    const r = await makeTestCompiler(job.config).renderToResult(job.lessPath, { outputFile: job.expectedFile });
    return r.css === readFileSync(job.expectedFile!, 'utf8');
  });
  if ('timedOut' in res) return { file: job.file, kind: 'render', outcome: 'timeout' };
  if ('error' in res) return { file: job.file, kind: 'render', outcome: 'error', detail: firstLine(res.error) };
  return { file: job.file, kind: 'render', outcome: res.value ? 'pass' : 'mismatch' };
}

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
