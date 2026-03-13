/**
 * Parser benchmark: Chevrotain ALL(*) vs hand-written recursive-descent
 *
 * Usage:
 *   npx tsx test/bench.ts
 *   npx tsx test/bench.ts --profile    # generates V8 CPU profile
 *   npx tsx test/bench.ts --per-file   # per-file breakdown
 *
 * With GC stats:
 *   node --expose-gc --import tsx test/bench.ts
 */
import { Lexer } from 'chevrotain';
import { cssLexer } from '../src/cssTokens.js';
import { CssActionsParser } from '../src/cssActionsParser.js';
import { CssRecursiveParser } from '../src/cssRecursiveParser.js';
import { type TokenMap } from '../src/cssActionsParser.js';
import type { IToken } from '@jesscss/parser-runtime';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);

// ── Collect CSS corpus ──────────────────────────────────────────────

function collectTestCSS(): { name: string; css: string }[] {
  const files: { name: string; css: string }[] = [];

  // Less test-data CSS outputs (real-world compiled CSS)
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
    } catch { /* skip */ }
  }
  if (!foundTestData) {
    console.warn('⚠ @less/test-data not found, using local CSS files only');
  }

  // Local CSS test fixtures
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
  } catch { /* skip unreadable dirs */ }
  return results;
}

// ── Setup ────────────────────────────────────────────────────────────

const WARMUP = 10;
const ITERATIONS = process.env.BENCH_ITERATIONS ? parseInt(process.env.BENCH_ITERATIONS, 10) : 100;

const corpus = collectTestCSS();
const allCSS = corpus.map(f => f.css).join('\n\n');
console.log(`Corpus: ${corpus.length} files, ${allCSS.length} chars, ~${allCSS.split('\n').length} lines\n`);

const { lexer: lexerDef, T } = cssLexer;
const lexer = new Lexer(lexerDef, {
  ensureOptimizations: true,
  skipValidations: true
});

// Pre-lex
const lexResult = lexer.tokenize(allCSS);
console.log(`Tokens: ${lexResult.tokens.length}`);
if (lexResult.errors.length > 0) {
  console.warn(`Lexer errors: ${lexResult.errors.length}`);
}

// Create parsers
const chevrotainParser = new CssActionsParser(lexerDef, T);
const recursiveParser = new CssRecursiveParser(T as TokenMap);

// ── Parse functions ──────────────────────────────────────────────────

function parseChevrotain(tokens: any[]): number {
  chevrotainParser.input = tokens;
  chevrotainParser.stylesheet();
  return chevrotainParser.errors.length;
}

function parseRecursive(tokens: any[]): number {
  recursiveParser.input = tokens as IToken[];
  recursiveParser.stylesheet();
  return recursiveParser.errors.length;
}

// ── Benchmark runner ─────────────────────────────────────────────────

interface BenchResult {
  avg: number;
  median: number;
  min: number;
  max: number;
  p95: number;
  errors: number;
}

function bench(name: string, fn: (tokens: any[]) => number): BenchResult {
  // Warmup
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

  // Speedup comparison
  const baseline = results[0]!.r;
  const rec = results[1]!.r;
  const medianX = baseline.median / rec.median;
  const avgX = baseline.avg / rec.avg;
  console.log('');
  console.log(
    `Speedup: ${medianX.toFixed(2)}x median, ${avgX.toFixed(2)}x avg`
  );
}

// ── Memory measurement ───────────────────────────────────────────────

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

// ── Run ──────────────────────────────────────────────────────────────

console.log(`\n── Parse speed (${ITERATIONS} iterations) ──\n`);

const allResults: { name: string; r: BenchResult }[] = [];

const chevResult = bench('Chev ALL(*)', parseChevrotain);
allResults.push({ name: 'Chev ALL(*)', r: chevResult });

const recResult = bench('Recursive', parseRecursive);
allResults.push({ name: 'Recursive', r: recResult });

formatTable(allResults);

// Memory
if (global.gc) {
  console.log(`\n── Memory (${ITERATIONS} iterations, GC enabled) ──\n`);
  const chevMem = measureMemory(parseChevrotain);
  const recMem = measureMemory(parseRecursive);
  console.log(`Chev ALL(*): heap=${(chevMem.heapDelta / 1024).toFixed(0)}KB  rss=${(chevMem.rss / 1024).toFixed(0)}KB`);
  console.log(`Recursive:   heap=${(recMem.heapDelta / 1024).toFixed(0)}KB  rss=${(recMem.rss / 1024).toFixed(0)}KB`);
} else {
  console.log('\n(Run with --expose-gc for memory stats)');
}

// Per-file breakdown (optional)
if (process.argv.includes('--per-file')) {
  console.log(`\n── Per-file breakdown ──\n`);
  const nameW = Math.max(...corpus.map(f => f.name.length), 10);
  console.log(
    'File'.padEnd(nameW) + '   tokens  ALL(*)     Rec   Speedup'
  );
  console.log('─'.repeat(nameW + 42));

  for (const file of corpus) {
    const fileLex = lexer.tokenize(file.css);
    if (fileLex.errors.length > 0) {
      continue;
    }
    const N = 100;

    const t1 = performance.now();
    for (let i = 0; i < N; i++) {
      parseChevrotain(fileLex.tokens);
    }
    const chevTime = (performance.now() - t1) / N;

    const t2 = performance.now();
    for (let i = 0; i < N; i++) {
      parseRecursive(fileLex.tokens);
    }
    const recTime = (performance.now() - t2) / N;

    const ratio = chevTime / recTime;
    console.log(
      `${file.name.padEnd(nameW)} ${String(fileLex.tokens.length).padStart(7)}  `
      + `${chevTime.toFixed(2).padStart(6)}  ${recTime.toFixed(2).padStart(6)}  `
      + `${ratio.toFixed(2).padStart(7)}x`
    );
  }
}

// V8 CPU profiling
if (process.argv.includes('--profile')) {
  console.log('\n── V8 CPU Profile ──\n');
  const inspector = require('inspector');
  const session = new inspector.Session();
  session.connect();

  session.post('Profiler.enable', () => {
    session.post('Profiler.start', () => {
      for (let i = 0; i < ITERATIONS * 2; i++) {
        parseRecursive(lexResult.tokens);
      }
      session.post('Profiler.stop', (err: any, { profile }: any) => {
        if (!err) {
          const outPath = path.join(thisDir, 'recursive-parser.cpuprofile');
          fs.writeFileSync(outPath, JSON.stringify(profile));
          console.log(`Wrote ${outPath}`);
        }
        session.disconnect();
      });
    });
  });
}
