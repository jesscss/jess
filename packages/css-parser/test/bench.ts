/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Chevrotain-parser benchmark: token-array / JSON-snapshot casts are inherent framework integration. */
/**
 * Parser benchmark: Jess CSS parser vs saved Jess baseline snapshots
 *
 * Usage:
 *   pnpm exec tsx test/bench.ts
 *   pnpm exec tsx test/bench.ts --save
 *   pnpm exec tsx test/bench.ts --baseline test/bench-results/some-run.json
 *   pnpm exec tsx test/bench.ts --per-file
 *
 * With GC stats:
 *   node --expose-gc --import tsx test/bench.ts
 */
import { Lexer } from 'chevrotain';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { IToken } from 'chevrotain';
import { cssLexer } from '../src/cssTokens.js';
import { CssRecursiveParser, type TokenMap } from '../src/cssRecursiveParser.js';

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

const SAVE_RESULTS = hasFlag('--save');
const BASELINE_PATH = getFlagValue('--baseline');

function collectTestCSS(): { name: string; css: string }[] {
  const files: { name: string; css: string }[] = [];

  const testDataCandidates = [
    path.resolve(thisDir, '../../../node_modules/@less/test-data'),
    path.resolve(process.env.HOME || '~', 'git/oss/less.js/packages/test-data')
  ];

  let foundTestData = false;
  for (const testDataRoot of testDataCandidates) {
    try {
      if (fs.existsSync(testDataRoot) && fs.statSync(testDataRoot).isDirectory()) {
        const cssFiles = findCSSFiles(testDataRoot);
        for (const f of cssFiles) {
          files.push({ name: path.relative(testDataRoot, f), css: fs.readFileSync(f, 'utf-8') });
        }
        foundTestData = true;
        break;
      }
    } catch {
      // skip
    }
  }

  if (!foundTestData) {
    console.warn('⚠ @less/test-data not found, using local CSS files only');
  }

  const localDir = path.join(thisDir, 'css');
  if (fs.existsSync(localDir)) {
    for (const f of fs.readdirSync(localDir).filter(f => f.endsWith('.css'))) {
      files.push({ name: `local/${f}`, css: fs.readFileSync(path.join(localDir, f), 'utf-8') });
    }
  }

  return files;
}

function findCSSFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        results.push(...findCSSFiles(full));
      } else if (entry.name.endsWith('.css')) {
        results.push(full);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return results;
}

const WARMUP = 10;
const ITERATIONS = process.env.BENCH_ITERATIONS ? parseInt(process.env.BENCH_ITERATIONS, 10) : 100;
const RESULT_NAME = 'Jess CSS parser';

const corpus = collectTestCSS();
const allCSS = corpus.map(f => f.css).join('\n\n');
console.log(`Corpus: ${corpus.length} files, ${allCSS.length} chars, ~${allCSS.split('\n').length} lines\n`);

const { lexer: lexerDef, T } = cssLexer;
const lexer = new Lexer(lexerDef, {
  ensureOptimizations: true,
  skipValidations: true
});
const lexResult = lexer.tokenize(allCSS);
console.log(`Tokens: ${lexResult.tokens.length}`);
if (lexResult.errors.length > 0) {
  console.warn(`Lexer errors: ${lexResult.errors.length}`);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const parser = new CssRecursiveParser(T as TokenMap);

function parseCurrent(tokens: any[]): number {
  parser.input = tokens as IToken[];
  parser.stylesheet();
  return parser.errors.length;
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
  tool: 'css-parser';
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
    lines: number;
    tokens: number;
  };
  warmup: number;
  iterations: number;
  args: string[];
  results: Array<BenchResult & { name: string }>;
}

function bench(fn: (tokens: any[]) => number): BenchResult {
  let errors = 0;
  for (let i = 0; i < WARMUP; i++) {
    errors = fn(lexResult.tokens);
  }

  if (global.gc) {
    global.gc();
  }

  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn(lexResult.tokens);
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
  console.log('Parser              median       avg       min       p95    errors');
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(
    `${RESULT_NAME.padEnd(18)}  ${fmt(result.median)}  ${fmt(result.avg)}  ${fmt(result.min)}  ${fmt(result.p95)}  ${String(result.errors).padStart(6)}`
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
    tool: 'css-parser',
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
      chars: allCSS.length,
      lines: allCSS.split('\n').length,
      tokens: lexResult.tokens.length
    },
    warmup: WARMUP,
    iterations: ITERATIONS,
    args: process.argv.slice(2),
    results: [{ name: RESULT_NAME, ...result }]
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = snapshot.recordedAt.replace(/[:.]/g, '-');
  const stampedPath = path.join(RESULTS_DIR, `css-parser-${stamp}.json`);
  const latestPath = path.join(RESULTS_DIR, 'latest.json');
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(stampedPath, json);
  fs.writeFileSync(latestPath, json);
  console.log(`\nSaved benchmark snapshot: ${stampedPath}`);
  console.log(`Updated latest snapshot: ${latestPath}`);
}

function measureMemory(fn: (tokens: any[]) => number): { heapDelta: number; rss: number } {
  if (global.gc) {
    global.gc();
  }
  const before = process.memoryUsage();

  for (let i = 0; i < ITERATIONS; i++) {
    fn(lexResult.tokens);
  }

  if (global.gc) {
    global.gc();
  }
  const after = process.memoryUsage();

  return {
    heapDelta: after.heapUsed - before.heapUsed,
    rss: after.rss - before.rss
  };
}

console.log(`\n── Parse speed (${ITERATIONS} iterations) ──\n`);

const result = bench(parseCurrent);
formatTable(result);

const baseline = loadBaseline();
if (baseline) {
  printComparison(result, baseline);
}

if (SAVE_RESULTS) {
  saveSnapshot(result);
}

if (global.gc) {
  console.log(`\n── Memory (${ITERATIONS} iterations, GC enabled) ──\n`);
  const mem = measureMemory(parseCurrent);
  console.log(`Jess CSS parser: heap=${(mem.heapDelta / 1024).toFixed(0)}KB  rss=${(mem.rss / 1024).toFixed(0)}KB`);
} else {
  console.log('\n(Run with --expose-gc for memory stats)');
}

if (hasFlag('--per-file')) {
  console.log(`\n── Per-file breakdown ──\n`);
  const nameW = Math.max(...corpus.map(f => f.name.length), 10);
  console.log('File'.padEnd(nameW) + '   tokens     ms');
  console.log('─'.repeat(nameW + 18));

  for (const file of corpus) {
    const fileLex = lexer.tokenize(file.css);
    if (fileLex.errors.length > 0) {
      continue;
    }
    const N = 100;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      parseCurrent(fileLex.tokens);
    }
    const avgMs = (performance.now() - t0) / N;
    console.log(
      `${file.name.padEnd(nameW)} ${String(fileLex.tokens.length).padStart(7)}  ${avgMs.toFixed(2).padStart(6)}`
    );
  }
}
