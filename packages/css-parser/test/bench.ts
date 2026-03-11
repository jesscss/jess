/**
 * Parser benchmark: Chevrotain (CssActionsParser) vs hand-written (CssRecursiveParser)
 *
 * Usage:
 *   npx tsx test/bench.ts
 *   npx tsx test/bench.ts --profile    # generates V8 CPU profile
 *   npx tsx test/bench.ts --heap       # generates V8 heap snapshot
 *
 * With GC stats:
 *   node --expose-gc --import tsx test/bench.ts
 */
import { Lexer } from 'chevrotain';
import { cssLexer } from '../src/cssTokens.js';
import { CssActionsParser } from '../src/cssActionsParser.js';
import { CssRecursiveParser, type TokenMap } from '../src/cssRecursiveParser.js';
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
const ITERATIONS = 100;

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

function formatResult(r: BenchResult): string {
  return `avg=${r.avg.toFixed(2)}ms  median=${r.median.toFixed(2)}ms  min=${r.min.toFixed(2)}ms  p95=${r.p95.toFixed(2)}ms  errors=${r.errors}`;
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

const chevResult = bench('Chevrotain', parseChevrotain);
console.log(`Chevrotain:  ${formatResult(chevResult)}`);

const recResult = bench('Recursive', parseRecursive);
console.log(`Recursive:   ${formatResult(recResult)}`);

const speedup = chevResult.median / recResult.median;
const avgSpeedup = chevResult.avg / recResult.avg;
console.log(`\nSpeedup:     ${speedup.toFixed(2)}x median, ${avgSpeedup.toFixed(2)}x avg`);

// Memory
console.log(`\n── Memory (${ITERATIONS} iterations) ──\n`);
const chevMem = measureMemory(parseChevrotain);
const recMem = measureMemory(parseRecursive);
console.log(`Chevrotain:  heap=${(chevMem.heapDelta / 1024).toFixed(0)}KB  rss=${(chevMem.rss / 1024).toFixed(0)}KB`);
console.log(`Recursive:   heap=${(recMem.heapDelta / 1024).toFixed(0)}KB  rss=${(recMem.rss / 1024).toFixed(0)}KB`);

// Per-file breakdown (optional)
if (process.argv.includes('--per-file')) {
  console.log(`\n── Per-file breakdown ──\n`);
  for (const file of corpus) {
    const fileLex = lexer.tokenize(file.css);
    if (fileLex.errors.length > 0) {
      continue;
    }

    const t1 = performance.now();
    for (let i = 0; i < 100; i++) {
      parseChevrotain(fileLex.tokens);
    }
    const chevTime = (performance.now() - t1) / 100;

    const t2 = performance.now();
    for (let i = 0; i < 100; i++) {
      parseRecursive(fileLex.tokens);
    }
    const recTime = (performance.now() - t2) / 100;

    const ratio = chevTime / recTime;
    const bar = ratio > 1 ? '█'.repeat(Math.min(20, Math.round(ratio * 5))) : '░'.repeat(Math.min(20, Math.round((1 / ratio) * 5)));
    console.log(`  ${ratio > 1 ? '✓' : '✗'} ${ratio.toFixed(2)}x  ${bar}  ${file.name} (${fileLex.tokens.length} tok)`);
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
