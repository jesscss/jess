/**
 * PROBE — not a proposed change.
 *
 * Question: in the RECOGNIZER profile phase (all capture allocations forced to
 * `undefined`, no host build, no reducers), does the AST host-mode artifact do
 * the same work as the CST host-mode artifact? Node counts are identical by
 * construction, so any timing gap is a codegen difference, not a workload one.
 *
 * Alternates A/B within each round to cancel drift and JIT order effects.
 *
 *   node docs/perf/probe-recognizer-symmetry.mjs [warmup=5] [rounds=9]
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, cstBuildHost } from 'parseman';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const warmup = Number(process.argv[2] ?? 5);
const rounds = Number(process.argv[3] ?? 9);

function find(dir, pattern, maxdepth) {
  const args = ['-L', resolve(repo, dir)];
  if (maxdepth) args.push('-maxdepth', String(maxdepth));
  args.push('-type', 'f', '-name', pattern);
  try {
    return execFileSync('find', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n').filter(Boolean).sort();
  } catch { return []; }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function pass(entry, trivia, sources, build) {
  const t0 = performance.now();
  for (const src of sources) {
    run(entry, src, { trivia, ...(build ? { build } : { state: { source: src } }) });
  }
  return performance.now() - t0;
}

const cases = [];
{
  const g = await import(resolve(repo, 'packages/syntax/css/css-parser/lib/grammar.js'));
  cases.push({
    name: 'css / css-parser test corpus',
    g, dialect: 'css',
    sources: find('packages/syntax/css/css-parser/test/css', '*.css', 1).map(f => readFileSync(f, 'utf8'))
  });
}
{
  const g = await import(resolve(repo, 'packages/syntax/less/less-parser/lib/grammar.js'));
  cases.push({
    name: 'less / benchmark.less',
    g, dialect: 'less',
    sources: [readFileSync(resolve(repo, 'packages/jess/benchmark/benchmark.less'), 'utf8')]
  });
}

for (const { name, g, dialect, sources } of cases) {
  const astG = g[`${dialect}Grammar`];
  const cstG = g[`${dialect}CstGrammar`];
  const host = cstBuildHost();
  const bytes = sources.reduce((n, s) => n + s.length, 0);

  for (let i = 0; i < warmup; i++) {
    pass(astG.Stylesheet, astG.whitespace, sources);
    pass(cstG.Stylesheet, cstG.whitespace ?? cstG.rw, sources, host);
  }

  const a = [], c = [];
  for (let i = 0; i < rounds; i++) {
    if (i % 2 === 0) {
      a.push(pass(astG.Stylesheet, astG.whitespace, sources));
      c.push(pass(cstG.Stylesheet, cstG.whitespace ?? cstG.rw, sources, host));
    } else {
      c.push(pass(cstG.Stylesheet, cstG.whitespace ?? cstG.rw, sources, host));
      a.push(pass(astG.Stylesheet, astG.whitespace, sources));
    }
  }
  const am = median(a), cm = median(c);
  const spread = xs => ((Math.max(...xs) - Math.min(...xs)) / median(xs) * 100).toFixed(1);
  console.log(`\n=== ${name} — ${sources.length} files, ${bytes} bytes ===`);
  console.log(`  full parse (reducers/host build INCLUDED, not recognizer-only)`);
  console.log(`  ast median ${am.toFixed(2)} ms   spread ${spread(a)}%   samples ${a.length}`);
  console.log(`  cst median ${cm.toFixed(2)} ms   spread ${spread(c)}%   samples ${c.length}`);
  console.log(`  ast/cst = ${(am / cm).toFixed(3)}`);
}
