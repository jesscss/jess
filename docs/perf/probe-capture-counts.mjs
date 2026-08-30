/**
 * PROBE — not a proposed change, not a harness replacement.
 *
 * Counts REALIZED per-parse work through Parseman's own built-in profile
 * counters, for the AST host-mode artifact and the CST host-mode artifact of
 * the same grammar, over the same corpus. Counts have no noise floor; this is
 * deliberately not a timing run.
 *
 * Measures the built `lib/` artifact (the macro-compiled code that ships).
 *
 *   node docs/perf/probe-capture-counts.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'parseman';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function find(dir, pattern, maxdepth) {
  const args = ['-L', resolve(repo, dir)];
  if (maxdepth) args.push('-maxdepth', String(maxdepth));
  args.push('-type', 'f', '-name', pattern);
  try {
    return execFileSync('find', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n').filter(Boolean).sort();
  } catch {
    return [];
  }
}

const EMPTY = { nodes: 0, childSlots: 0, rawSlots: 0, triviaSlots: 0, fieldSlots: 0, hostCalls: 0, files: 0, bytes: 0, fails: 0 };

const PHASES = ['recognizer', 'structuralCapture', 'hostConstruction'];
const KEYS = ['nodes', 'childSlots', 'rawSlots', 'triviaSlots', 'fieldSlots', 'hostCalls', 'ms'];

function blank() {
  const a = { files: 0, bytes: 0, fails: 0 };
  for (const ph of PHASES) { a[ph] = {}; for (const k of KEYS) a[ph][k] = 0; }
  return a;
}

function tally(grammar, entryName, sources, build) {
  const entry = grammar[entryName];
  const trivia = grammar.whitespace ?? grammar.rw;
  const acc = blank();
  for (const src of sources) {
    let r;
    try {
      r = run(entry, src, {
        trivia,
        ...(build ? { build } : { state: { source: src } }),
        profile: true
      });
    } catch (e) {
      acc.fails++;
      if (acc.fails === 1) acc.firstError = String(e).slice(0, 160);
      continue;
    }
    if (!r.ok) { acc.fails++; continue; }
    for (const ph of PHASES) {
      const p = r.profile?.[ph];
      if (!p) continue;
      for (const k of KEYS) acc[ph][k] += p[k] ?? 0;
    }
    acc.files++; acc.bytes += src.length;
  }
  return acc;
}

const targets = [];

const cssFiles = find('packages/syntax/css/css-parser/test/css', '*.css', 1);
if (cssFiles.length) {
  const g = await import('@jesscss/css-parser/grammar.js').catch(() => null)
    ?? await import(resolve(repo, 'packages/syntax/css/css-parser/lib/grammar.js'));
  targets.push({ dialect: 'css', g, sources: cssFiles.map(f => readFileSync(f, 'utf8')) });
}

const lessFile = resolve(repo, 'packages/jess/benchmark/benchmark.less');
{
  const g = await import(resolve(repo, 'packages/syntax/less/less-parser/lib/grammar.js'));
  targets.push({ dialect: 'less', g, sources: [readFileSync(lessFile, 'utf8')] });
}

const { cstBuildHost } = await import('parseman');

for (const { dialect, g, sources } of targets) {
  const astG = g[`${dialect}Grammar`];
  const cstG = g[`${dialect}CstGrammar`];
  const ast = tally(astG, 'Stylesheet', sources);
  const cst = tally(cstG, 'Stylesheet', sources, cstBuildHost());
  console.log(`\n=== ${dialect} — ${sources.length} sources, ${ast.bytes} bytes ===`);
  console.log(`  files ast=${ast.files}/${sources.length} fails=${ast.fails}   cst=${cst.files}/${sources.length} fails=${cst.fails}`);
  if (ast.firstError) console.log(`  ast first error: ${ast.firstError}`);
  if (cst.firstError) console.log(`  cst first error: ${cst.firstError}`);
  for (const ph of PHASES) {
    console.log(`  -- ${ph}`);
    for (const k of KEYS) {
      const a = ast[ph][k], c = cst[ph][k];
      const fmt = v => (k === 'ms' ? v.toFixed(2) : String(v));
      const ratio = c === 0 ? 'n/a' : (a / c).toFixed(3);
      console.log(`     ${k.padEnd(12)} ast=${fmt(a).padStart(10)}  cst=${fmt(c).padStart(10)}  ast/cst=${ratio}`);
    }
  }
}
