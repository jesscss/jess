/**
 * Parser benchmark: Jess Less parser vs saved Jess baseline snapshots
 *
 * Usage:
 *   pnpm exec tsx test/bench.ts
 *   pnpm exec tsx test/bench.ts --benchmark
 *   pnpm exec tsx test/bench.ts --save
 *   pnpm exec tsx test/bench.ts --baseline test/bench-results/some-run.json
 *
 * Memory profiling:
 *   node --expose-gc -r tsx/cjs test/bench.ts --memory
 */
import { execSync } from 'child_process';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Parser } from '../src/index.js';

const INVALID_LESS = new Set([
  'tests-unit/permissive-parse/permissive-parse.less',
  'tests-unit/permissive-parse/legacy/permissive-parse.less',
  'tests-unit/property-name-interp/property-name-interp.less',
  'tests-unit/import/import/invalid-css.less',
  'tests-unit/selectors/selectors.less',
  'tests-unit/variables-in-at-rules/variables-in-at-rules.less',
  'tests-unit/functions/legacy/functions.less',
  'tests-unit/operations/operations.less',
  'tests-unit/container/container.less',
  'tests-unit/variables/variables.less',
  'tests-unit/css-guards/css-guards.less',
  'tests-unit/extract-and-length/extract-and-length.less',
  'tests-unit/parser-property-interp/parser-property-interp.less',
  'tests-unit/parser-slashed-combinator/parser-slashed-combinator.less',
  'tests-unit/javascript/javascript.less'
]);

const require = createRequire(import.meta.url);
const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const RESULTS_DIR = path.join(thisDir, 'bench-results');

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getFlagValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) {
    return undefined;
  }
  return process.argv[idx + 1];
}

const useBenchmark = hasFlag('--benchmark');
const SAVE_RESULTS = hasFlag('--save');
const BASELINE_PATH = getFlagValue('--baseline');
const RESULT_NAME = 'Jess Less parser';

function collectTestLess(): { name: string; less: string }[] {
  const files: { name: string; less: string }[] = [];

  let testDataRoot: string;
  try {
    testDataRoot = path.dirname(require.resolve('@less/test-data'));
  } catch {
    testDataRoot = path.resolve(thisDir, '../../../node_modules/@less/test-data');
  }

  if (testDataRoot && fs.existsSync(testDataRoot)) {
    const unitDir = path.join(testDataRoot, 'tests-unit');
    if (fs.existsSync(unitDir)) {
      function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.name.endsWith('.less')) {
            const rel = path.relative(testDataRoot, full);
            if (!INVALID_LESS.has(rel) && !rel.includes('-REMOVED')) {
              files.push({ name: rel, less: fs.readFileSync(full, 'utf-8') });
            }
          }
        }
      }
      walk(unitDir);
    }
  }

  if (files.length === 0) {
    console.warn('⚠ @less/test-data not found or empty. Install or link @less/test-data.');
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function loadBenchmarkFile(): { name: string; less: string }[] {
  const benchPath = path.resolve(thisDir, '../../jess/benchmark/benchmark.less');
  if (!fs.existsSync(benchPath)) {
    console.warn('⚠ benchmark.less not found at packages/jess/benchmark/benchmark.less');
    return [];
  }
  const content = fs.readFileSync(benchPath, 'utf-8');
  if (content.length < 100) {
    console.warn('⚠ benchmark.less appears to be a stub (too small)');
    return [];
  }
  return [{ name: 'benchmark.less', less: content }];
}

const WARMUP = 5;
const ITERATIONS = process.env.BENCH_ITERATIONS
  ? parseInt(process.env.BENCH_ITERATIONS, 10)
  : useBenchmark ? 100 : 50;

const corpus = useBenchmark ? loadBenchmarkFile() : collectTestLess();
const totalChars = corpus.reduce((s, f) => s + f.less.length, 0);
console.log(`Corpus: ${corpus.length} files, ${totalChars} chars\n`);

if (corpus.length === 0) {
  process.exit(1);
}

const parser = new Parser();

function parseJess(text: string): number {
  const result = parser.parse(text);
  return result.errors.length + (result.lexerResult?.errors?.length ?? 0);
}

interface BenchResult {
  avg: number;
  median: number;
  min: number;
  max: number;
  p95: number;
  errors: number;
}

interface SavedBenchSnapshot {
  tool: 'less-parser';
  model?: 'jess-vs-jess';
  recordedAt: string;
  git: {
    commit: string;
    dirty: boolean;
  };
  env: {
    node: string;
    platform: string;
    arch: string;
  };
  corpus: {
    files: number;
    chars: number;
    benchmarkOnly: boolean;
  };
  warmup: number;
  iterations: number;
  args: string[];
  results: Array<BenchResult & { name: string }>;
}

function benchSync(fn: (text: string) => number): BenchResult {
  let errors = 0;
  for (let i = 0; i < WARMUP; i++) {
    for (const f of corpus) {
      errors += fn(f.less);
    }
  }

  if (global.gc) {
    global.gc();
  }

  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    for (const f of corpus) {
      fn(f.less);
    }
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const p95idx = Math.floor(times.length * 0.95);

  return {
    avg,
    median: times[Math.floor(times.length / 2)]!,
    min: times[0]!,
    max: times[times.length - 1]!,
    p95: times[p95idx]!,
    errors
  };
}

function fmt(ms: number): string {
  return ms.toFixed(2).padStart(8) + 'ms';
}

function formatTable(result: BenchResult): void {
  console.log('Parser               median       avg       min       p95    errors');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log(
    `${RESULT_NAME.padEnd(19)}  ${fmt(result.median)}  ${fmt(result.avg)}  ${fmt(result.min)}  ${fmt(result.p95)}  ${String(result.errors).padStart(6)}`
  );
}

function getGitInfo(): SavedBenchSnapshot['git'] {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: thisDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const dirty = execSync('git status --porcelain', { cwd: thisDir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: false };
  }
}

function loadBaseline(): SavedBenchSnapshot | undefined {
  const explicit = BASELINE_PATH ? path.resolve(process.cwd(), BASELINE_PATH) : undefined;
  const latest = path.join(RESULTS_DIR, 'latest.json');
  const target = explicit ?? latest;
  if (!fs.existsSync(target)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as SavedBenchSnapshot;
  } catch {
    console.warn(`⚠ Failed to read baseline snapshot: ${target}`);
    return undefined;
  }
}

function getPrimaryResult(snapshot: SavedBenchSnapshot): BenchResult | undefined {
  const result = snapshot.results.find(r => r.name === RESULT_NAME);
  if (!result) {
    console.warn('⚠ Baseline snapshot is not in the current Jess-vs-Jess format; skipping comparison.');
  }
  return result;
}

function printComparison(current: BenchResult, baseline: SavedBenchSnapshot): void {
  const prior = getPrimaryResult(baseline);
  if (!prior) {
    return;
  }

  const deltaMedian = current.median - prior.median;
  const deltaAvg = current.avg - prior.avg;
  const medianPct = prior.median === 0 ? 0 : (deltaMedian / prior.median) * 100;
  const avgPct = prior.avg === 0 ? 0 : (deltaAvg / prior.avg) * 100;
  const medianWord = deltaMedian <= 0 ? 'faster' : 'slower';
  const avgWord = deltaAvg <= 0 ? 'faster' : 'slower';

  console.log('\n── Baseline Comparison ──\n');
  console.log(`Baseline: ${baseline.git.commit} from ${baseline.recordedAt}`);
  console.log(`Median:   ${fmt(prior.median)} -> ${fmt(current.median)}  (${Math.abs(deltaMedian).toFixed(2)}ms, ${Math.abs(medianPct).toFixed(2)}% ${medianWord})`);
  console.log(`Avg:      ${fmt(prior.avg)} -> ${fmt(current.avg)}  (${Math.abs(deltaAvg).toFixed(2)}ms, ${Math.abs(avgPct).toFixed(2)}% ${avgWord})`);
}

function saveSnapshot(result: BenchResult): void {
  const snapshot: SavedBenchSnapshot = {
    tool: 'less-parser',
    model: 'jess-vs-jess',
    recordedAt: new Date().toISOString(),
    git: getGitInfo(),
    env: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    corpus: {
      files: corpus.length,
      chars: totalChars,
      benchmarkOnly: useBenchmark
    },
    warmup: WARMUP,
    iterations: ITERATIONS,
    args: process.argv.slice(2),
    results: [{ name: RESULT_NAME, ...result }]
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = snapshot.recordedAt.replace(/[:.]/g, '-');
  const stampedPath = path.join(RESULTS_DIR, `less-parser-${stamp}.json`);
  const latestPath = path.join(RESULTS_DIR, 'latest.json');
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(stampedPath, json);
  fs.writeFileSync(latestPath, json);
  console.log(`\nSaved benchmark snapshot: ${stampedPath}`);
  console.log(`Updated latest snapshot: ${latestPath}`);
}

console.log(`── Parse speed (${ITERATIONS} iterations, ${corpus.length} files) ──\n`);

const result = benchSync(parseJess);
formatTable(result);

const baseline = loadBaseline();
if (baseline) {
  printComparison(result, baseline);
}

if (SAVE_RESULTS) {
  saveSnapshot(result);
}

if (hasFlag('--memory')) {
  const MEM_ITER = Math.min(ITERATIONS, 100);
  console.log(`\n── Memory (${MEM_ITER} iterations, GC before/after) ──\n`);

  if (!global.gc) {
    console.log('Run with: node --expose-gc -r tsx/cjs test/bench.ts --memory');
  } else {
    global.gc();
    const before = process.memoryUsage();

    for (let i = 0; i < MEM_ITER; i++) {
      for (const f of corpus) {
        parseJess(f.less);
      }
    }

    global.gc();
    const after = process.memoryUsage();
    const fmtKb = (n: number) => (n / 1024).toFixed(0) + 'KB';
    console.log('Parser               heap delta    rss delta    heap used');
    console.log('──────────────────────────────────────────────────────────');
    console.log(
      `${RESULT_NAME.padEnd(19)} ${fmtKb(after.heapUsed - before.heapUsed).padStart(11)}  ${fmtKb(after.rss - before.rss).padStart(11)}  ${fmtKb(after.heapUsed)}`
    );
  }
}
