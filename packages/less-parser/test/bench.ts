/**
 * Parser benchmark: Jess Less parser vs Less.js 4.x (parse-only)
 *
 * Less.js does not expose a public parse-only API, but `less.render()` internally
 * calls `less.parse()` first, then compiles. We use `less.parse()` directly for
 * parse-only timing.
 *
 * Usage:
 *   pnpm exec tsx test/bench.ts
 *   pnpm exec tsx test/bench.ts --benchmark   # run on benchmark.less only
 *   pnpm exec tsx test/bench.ts --memory      # heap/rss comparison (requires node --expose-gc)
 *   pnpm exec tsx test/bench.ts --heap-snapshot  # write .heapsnapshot for DevTools
 *   BENCH_ITERATIONS=50 pnpm exec tsx test/bench.ts
 *
 * Memory profiling:
 *   pnpm bench:memory   or  node --expose-gc -r tsx/cjs test/bench.ts --memory
 *   pnpm bench:heap     or  node --expose-gc -r tsx/cjs test/bench.ts --heap-snapshot
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { Parser } from '../src/index.js';
// Same exclusions as less-unit-tests (from @jesscss/shared invalidLess)
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

// ── Collect Less corpus ───────────────────────────────────────────────

function collectTestLess(): { name: string; less: string }[] {
  const files: { name: string; less: string }[] = [];

  let testDataRoot: string;
  try {
    testDataRoot = path.dirname(require.resolve('@less/test-data'));
  } catch {
    // Fallback: node_modules at repo root
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

// ── Setup ─────────────────────────────────────────────────────────────

const useBenchmark = process.argv.includes('--benchmark');
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

const jessParser = new Parser();

// Less.js: parse-only (same path render() uses internally)
let less: { parse: (input: string, options?: object) => Promise<unknown> };
try {
  const mod = await import('less');
  less = mod.default ?? mod;
} catch {
  console.error('less not found. Add "less" as root devDependency');
  process.exit(1);
}

// ── Parse functions ───────────────────────────────────────────────────

function parseJess(text: string): number {
  const result = jessParser.parse(text);
  return result.errors.length + (result.lexerResult?.errors?.length ?? 0);
}

async function parseLessJs(text: string): Promise<number> {
  try {
    await less.parse(text, { filename: 'input.less' });
    return 0;
  } catch {
    return 1;
  }
}

// ── Benchmark runner ──────────────────────────────────────────────────

interface BenchResult {
  avg: number;
  median: number;
  min: number;
  max: number;
  p95: number;
  errors: number;
}

function benchSync(name: string, fn: (text: string) => number): BenchResult {
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

async function benchAsync(
  name: string,
  fn: (text: string) => Promise<number>
): Promise<BenchResult> {
  let errors = 0;
  for (let i = 0; i < WARMUP; i++) {
    for (const f of corpus) {
      errors += await fn(f.less);
    }
  }

  if (global.gc) {
    global.gc();
  }

  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    for (const f of corpus) {
      await fn(f.less);
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

function formatTable(results: { name: string; r: BenchResult }[]): void {
  const nameW = Math.max(...results.map(x => x.name.length));
  console.log(
    'Parser'.padEnd(nameW) + '    median       avg       min       p95    errors'
  );
  console.log('─'.repeat(nameW + 56));
  for (const { name, r } of results) {
    console.log(
      `${name.padEnd(nameW)}  ${fmt(r.median)}  ${fmt(r.avg)}  ${fmt(r.min)}  ${fmt(r.p95)}  ${String(r.errors).padStart(6)}`
    );
  }

  const jess = results.find(x => x.name.includes('Jess'))?.r;
  const lessResult = results.find(x => x.name.includes('Less'))?.r;
  if (jess && lessResult) {
    const jessFaster = jess.median < lessResult.median;
    const ratio = jessFaster ? lessResult.median / jess.median : jess.median / lessResult.median;
    const winner = jessFaster ? 'Jess' : 'Less.js';
    console.log('');
    console.log(
      `Jess vs Less.js: ${winner} ${ratio.toFixed(2)}x faster (median)`
    );
  }
}

// ── Run ──────────────────────────────────────────────────────────────

console.log(`── Parse speed (${ITERATIONS} iterations, ${corpus.length} files) ──\n`);

const jessResult = benchSync('Jess', parseJess);
const lessResult = await benchAsync('Less.js 4.x', parseLessJs);

formatTable([
  { name: 'Jess', r: jessResult },
  { name: 'Less.js 4.x', r: lessResult }
]);

// ── Memory (process.memoryUsage) ──────────────────────────────────────

if (process.argv.includes('--memory')) {
  const MEM_ITER = Math.min(ITERATIONS, 100);
  console.log(`\n── Memory (${MEM_ITER} iterations, GC before/after) ──\n`);

  if (!global.gc) {
    console.log('Run with: node --expose-gc --import tsx test/bench.ts --memory');
  } else {
    async function measureMemory(
      name: string,
      fn: (text: string) => number | Promise<number>,
      isAsync: boolean
    ): Promise<{ heapDelta: number; rss: number; heapUsed: number }> {
      global.gc!();
      const before = process.memoryUsage();

      if (isAsync) {
        for (let i = 0; i < MEM_ITER; i++) {
          for (const f of corpus) {
            await (fn as (t: string) => Promise<number>)(f.less);
          }
        }
      } else {
        for (let i = 0; i < MEM_ITER; i++) {
          for (const f of corpus) {
            (fn as (t: string) => number)(f.less);
          }
        }
      }

      global.gc!();
      const after = process.memoryUsage();

      return {
        heapDelta: after.heapUsed - before.heapUsed,
        rss: after.rss - before.rss,
        heapUsed: after.heapUsed
      };
    }

    const jessMem = await measureMemory('Jess', parseJess, false);
    const lessMem = await measureMemory('Less.js', parseLessJs, true);

    const fmtKb = (n: number) => (n / 1024).toFixed(0) + 'KB';
    console.log('Parser         heap delta    rss delta    heap used');
    console.log('─'.repeat(50));
    console.log(`Jess           ${fmtKb(jessMem.heapDelta).padStart(8)}     ${fmtKb(jessMem.rss).padStart(8)}     ${fmtKb(jessMem.heapUsed)}`);
    console.log(`Less.js 4.x    ${fmtKb(lessMem.heapDelta).padStart(8)}     ${fmtKb(lessMem.rss).padStart(8)}     ${fmtKb(lessMem.heapUsed)}`);
  }
}

// ── Heap snapshots (V8 .heapsnapshot for DevTools) ───────────────────

if (process.argv.includes('--heap-snapshot')) {
  console.log('\n── Writing heap snapshots ──\n');

  const v8 = await import('v8');
  const writeSnapshot = (prefix: string) => {
    const file = path.join(thisDir, `${prefix}-${Date.now()}.heapsnapshot`);
    const fd = v8.writeHeapSnapshot(file);
    console.log(`  ${prefix}: ${fd}`);
    return fd;
  };

  if (global.gc) {
    global.gc();
  }
  writeSnapshot('jess-before');

  for (let i = 0; i < 20; i++) {
    for (const f of corpus) {
      parseJess(f.less);
    }
  }
  if (global.gc) {
    global.gc();
  }
  writeSnapshot('jess-after');

  if (global.gc) {
    global.gc();
  }
  writeSnapshot('lessjs-before');

  for (let i = 0; i < 20; i++) {
    for (const f of corpus) {
      await parseLessJs(f.less);
    }
  }
  if (global.gc) {
    global.gc();
  }
  writeSnapshot('lessjs-after');

  console.log('\nOpen .heapsnapshot files in Chrome DevTools → Memory → Load.');
}
