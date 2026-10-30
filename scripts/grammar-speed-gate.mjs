#!/usr/bin/env node
/**
 * Grammar speed gate: marginal INSTRUCTIONS per AST parse, per grammar, against
 * `scripts/grammar-speed.baseline.json`.
 *
 * WHY. On 2026-08-31 Less `benchmark.less` parse went 16.9 → 27.6 ms when the
 * Less, SCSS and `.jess` grammars lost parseman's precompiled assembly
 * (jesscss/jess#508), and no CI check measured parse cost. The perf drift gate
 * (`scripts/perf-gate/`) ships disabled and grades a jess/lessc wall-time ratio
 * that needs a null calibration it does not have.
 *
 * THE METRIC is the canonical one in `docs/perf/BENCHMARKS.md`: run a grammar's
 * own `test/parse-bench.mjs` with no warm-up at two parse counts and take
 * `(I(N2) − I(N1)) / (N2 − N1)`. Startup and module load are paid by both runs
 * and cancel. Each grammar is measured REPS times, N1 and N2 interleaved
 * (alternating order each rep), and the median is gated.
 *
 * THE COUNTER. Instructions, not wall time: wall time on a shared runner swings
 * with load, instruction counts do not.
 *   - linux: Valgrind (Cachegrind, `--cache-sim=no`), its `I refs` total.
 *     GitHub-hosted runners expose no hardware PMU (`perf stat -e instructions`
 *     reports `<not supported>`), so the hardware count is unavailable there.
 *   - darwin: `/usr/bin/time -l`'s `instructions retired` (hardware), for
 *     local runs. Its numbers are not comparable to Cachegrind's.
 *
 * THE ENGINE: V8's interpreter (`--jitless --single-threaded
 * --predictable-gc-schedule`), and this is the trade-off. Under Valgrind,
 * JIT-compiled code is slow to translate and its tier-up is not settled
 * before ~24 parses: measured on GitHub runners, the Less JIT marginal was
 * still falling at N 12 → 24 (547M → 487M), CSS read 194-210M across three
 * runners (8%), and the window cost 4-5 minutes for two grammars. The
 * interpreter has no warm-up, so one parse is a steady-state window, and it
 * reads within 0.36% across runners and CPU models. It still sees the grammar
 * engine's work: stripping the precompiled assembly from the CSS artifact
 * costs +16% interpreted on CI (+36% JIT, macOS hardware count). It does not see
 * JIT-only costs (deopts, megamorphic inline caches); those need hardware
 * counters on a self-hosted runner, or `BENCHMARKS.md`'s local method.
 *
 * Instruction counts depend on the CPU architecture, the counter, the Node
 * version and the method, so the baseline records that environment and is
 * only compared under the same one. The CI `grammar-speed` job pins Node;
 * `--require-env` (CI) fails on any other environment. The parseman version is
 * NOT part of the environment: a parseman release is measured against the
 * baseline it replaces, and must be no slower.
 *
 * WHAT FAILS:
 *   REGRESSED  a grammar's median above baseline × (1 + tolerance).
 *   UNBANKED   a grammar's median below baseline × (1 − tolerance). Lower the
 *              baseline so the freed room cannot be spent again:
 *              `node scripts/grammar-speed-gate.mjs --lower` (CI environment).
 *   UNSTABLE   a grammar's own REPS spread wider than the tolerance: the
 *              measurement cannot resolve the threshold it enforces.
 *   INVALID    the fixture failed to parse (the error path is not the workload).
 *   BLIND      the in-run self-test: the same comparison, fed this run's
 *              measurement against a doctored baseline, must flag a regression
 *              and a win of twice the tolerance in every grammar.
 * The tolerance and the evidence it was set from are in the baseline file.
 * Raising a baseline value is a reviewed edit of that file; this script only
 * lowers (`--lower`) or proposes a fresh file for a new environment
 * (`--propose`, writes `<baseline>.new`, never the live file).
 *
 * Canaries: `scripts/__tests__/grammar-gates.test.mjs`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = 'scripts/grammar-speed.baseline.json';

/**
 * Each grammar's own parse bench and the case it gates (see `docs/perf/BENCHMARKS.md`).
 * `weight` is the rough cost of one parse in billions of instructions; it only
 * orders the pool, longest processes first, so the run does not end on one.
 */
export const GRAMMARS = {
  css: { bench: 'packages/syntax/css/css-parser/test/parse-bench.mjs', case: 'benchmark.css', weight: 1.6 },
  less: { bench: 'packages/syntax/less/less-parser/test/parse-bench.mjs', case: 'benchmark.less', weight: 3 },
  scss: { bench: 'packages/syntax/scss/scss-parser/test/parse-bench.mjs', case: 'gen-workload', weight: 11.3 },
  jess: { bench: 'packages/syntax/jess/jess-parser/test/parse-bench.mjs', case: 'benchmark.css', weight: 3.2 }
};

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

export const METHOD = {
  n1: Number(arg('n1', 1)),
  n2: Number(arg('n2', 2)),
  reps: Number(arg('reps', 2)),
  nodeFlags: arg('node-flags', '--jitless --single-threaded --predictable-gc-schedule').split(' ').filter(Boolean)
};

export const COUNTERS = {
  linux: {
    id: 'cachegrind-Ir',
    command: argv => ['valgrind', ['--tool=cachegrind', '--cache-sim=no', '--cachegrind-out-file=/dev/null', ...argv]],
    read: stderr => /I\s+refs:\s+([\d,]+)/.exec(stderr)?.[1].replaceAll(',', '')
  },
  darwin: {
    id: 'hw-instructions-retired',
    command: argv => ['/usr/bin/time', ['-l', ...argv]],
    read: stderr => /(\d+)\s+instructions retired/.exec(stderr)?.[1]
  }
};

export function environment(counter = COUNTERS[process.platform]) {
  return {
    counter: counter?.id ?? 'unsupported',
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    method: METHOD
  };
}

function runOne(counter, grammar, parses) {
  const { bench, case: name } = GRAMMARS[grammar];
  const [cmd, argv] = counter.command([process.execPath, ...METHOD.nodeFlags, join(ROOT, bench), 'gate', '0', String(parses)]);
  return new Promise((done, fail) => {
    const child = spawn(cmd, argv, {
      cwd: ROOT,
      env: { ...process.env, BENCH_CASES: name, BENCH_SURFACES: 'ast' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', fail);
    child.on('close', (code) => {
      const count = counter.read(stderr);
      const row = JSON.parse(stdout.trim().split('\n').at(-1) || '{}').out?.[`${name}/ast`];
      if (code !== 0 || count === undefined) {
        fail(new Error(`${grammar} N=${parses}: exit ${code}, no instruction count.\n${stderr.slice(-2000)}`));
      } else if (!row || row.thrown !== 0) {
        fail(new Error(`${grammar} N=${parses}: INVALID — fixture ${name} ${row ? `threw ${row.thrown} time(s)` : 'was not measured'}; the error path is not the workload.`));
      } else {
        done(Number(count));
      }
    });
  });
}

/** Runs every (grammar, rep, N) process through a pool; returns `{ grammar: { marginal, reps, spreadPct } }`. */
export async function measureSpeed(grammars = Object.keys(GRAMMARS)) {
  const counter = COUNTERS[process.platform];
  if (!counter) {
    throw new Error(`no instruction counter for ${process.platform}`);
  }
  const jobs = [];
  for (let rep = 0; rep < METHOD.reps; rep++) {
    for (const grammar of grammars) {
      const order = rep % 2 === 0 ? [METHOD.n1, METHOD.n2] : [METHOD.n2, METHOD.n1];
      for (const n of order) {
        jobs.push({ grammar, rep, n });
      }
    }
  }
  jobs.sort((a, b) => GRAMMARS[b.grammar].weight * (b.n + 1) - GRAMMARS[a.grammar].weight * (a.n + 1));
  const counts = new Map();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      counts.set(`${job.grammar}/${job.rep}/${job.n}`, await runOne(counter, job.grammar, job.n));
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), jobs.length) }, worker));

  const result = {};
  for (const grammar of grammars) {
    const reps = [];
    for (let rep = 0; rep < METHOD.reps; rep++) {
      reps.push((counts.get(`${grammar}/${rep}/${METHOD.n2}`) - counts.get(`${grammar}/${rep}/${METHOD.n1}`)) / (METHOD.n2 - METHOD.n1));
    }
    const sorted = [...reps].sort((a, b) => a - b);
    const marginal = Math.round(sorted[Math.floor(sorted.length / 2)]);
    result[grammar] = { marginal, reps: reps.map(Math.round), spreadPct: +((sorted.at(-1) - sorted[0]) / marginal * 100).toFixed(3) };
  }
  return result;
}

/** Pure comparison. `measured`: `{ grammar: { marginal, spreadPct } }`. */
export function compareSpeed(measured, baseline) {
  const tol = baseline.tolerancePct / 100;
  const failures = [];
  const unbanked = [];
  for (const grammar of new Set([...Object.keys(measured), ...Object.keys(baseline.grammars)])) {
    const now = measured[grammar];
    const base = baseline.grammars[grammar]?.instructionsPerParse;
    if (base === undefined) {
      failures.push(`${grammar}: NEW, not in ${BASELINE} — add it in a reviewed edit.`);
      continue;
    }
    if (!now) {
      failures.push(`${grammar}: baselined but not measured.`);
      continue;
    }
    const delta = `${((now.marginal / base - 1) * 100).toFixed(2)}%`;
    if (now.spreadPct > baseline.tolerancePct) {
      failures.push(`${grammar}: UNSTABLE — reps spread ${now.spreadPct}% exceeds the ${baseline.tolerancePct}% tolerance.`);
    }
    if (now.marginal > base * (1 + tol)) {
      failures.push(`${grammar}: REGRESSED ${base} → ${now.marginal} instructions per parse (${delta}, tolerance ${baseline.tolerancePct}%).`);
    } else if (now.marginal < base * (1 - tol)) {
      unbanked.push(`${grammar}: faster ${base} → ${now.marginal} instructions per parse (${delta}) — lower the baseline.`);
    }
  }
  return { failures, unbanked };
}

/** The in-run negative control: a doctored baseline must be caught in both directions. */
export function selfTest(measured, baseline) {
  const doctor = factor => ({
    ...baseline,
    grammars: Object.fromEntries(Object.entries(measured).map(([g, m]) => [g, { instructionsPerParse: m.marginal * factor }]))
  });
  const k = baseline.tolerancePct / 100;
  const slower = compareSpeed(measured, doctor(1 / (1 + 2 * k)));
  const faster = compareSpeed(measured, doctor(1 / (1 - 2 * k)));
  const all = Object.keys(measured);
  return all.every(g => slower.failures.some(f => f.startsWith(`${g}: REGRESSED`)))
    && all.every(g => faster.unbanked.some(f => f.startsWith(`${g}: faster`)));
}

const sameEnv = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const baselinePath = join(ROOT, BASELINE);
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const env = environment();
  if (process.platform === 'linux') {
    try {
      execFileSync('valgrind', ['--version'], { stdio: 'ignore' });
    } catch {
      console.error('grammar speed gate: valgrind is not installed (`sudo apt-get install -y valgrind`).');
      process.exit(1);
    }
  }
  const started = Date.now();
  const measured = await measureSpeed(arg('grammars', Object.keys(GRAMMARS).join(',')).split(','));
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const envMatches = sameEnv(env, baseline.env);

  console.log(`Grammar speed — marginal instructions per AST parse, (I(N${METHOD.n2}) − I(N${METHOD.n1}))/${METHOD.n2 - METHOD.n1}, median of ${METHOD.reps}, ${env.counter}, ${env.platform}, node ${env.node} (${seconds}s):`);
  for (const [grammar, m] of Object.entries(measured)) {
    const base = baseline.grammars[grammar]?.instructionsPerParse;
    const delta = envMatches && base ? `  ${((m.marginal / base - 1) * 100).toFixed(2).padStart(6)}% vs baseline ${base}` : '';
    console.log(`  ${grammar.padEnd(5)} ${GRAMMARS[grammar].case.padEnd(15)} ${String(m.marginal).padStart(12)}  spread ${m.spreadPct}%  reps ${m.reps.join(' ')}${delta}`);
  }

  if (process.argv.includes('--propose')) {
    const proposal = {
      ...baseline,
      env,
      grammars: Object.fromEntries(Object.entries(measured).map(([g, m]) => [g, { fixture: GRAMMARS[g].case, instructionsPerParse: m.marginal }]))
    };
    writeFileSync(`${baselinePath}.new`, `${JSON.stringify(proposal, null, 2)}\n`);
    console.log(`\nProposed ${BASELINE}.new — promoting it over the live file is a reviewed edit.`);
    return;
  }

  if (!envMatches) {
    const message = `This environment does not match the baseline's:\n  this run  ${JSON.stringify(env)}\n  baseline  ${JSON.stringify(baseline.env)}`;
    if (process.argv.includes('--require-env')) {
      console.error(`\n✗ ${message}\nGrammar speed gate FAILED: nothing was graded. The CI job pins Node; a pin change re-records the baseline in the same reviewed edit.`);
      process.exit(1);
    }
    console.log(`\n${message}\nReport only — not graded.`);
    return;
  }

  if (!selfTest(measured, baseline)) {
    console.error('\n✗ BLIND — a doctored baseline 2× the tolerance away was not flagged. Fix the gate before trusting it.');
    process.exit(1);
  }
  const { failures, unbanked } = compareSpeed(measured, baseline);
  if (process.argv.includes('--lower') && failures.length === 0 && unbanked.length > 0) {
    const grammars = { ...baseline.grammars };
    for (const [g, m] of Object.entries(measured)) {
      if (m.marginal < grammars[g].instructionsPerParse * (1 - baseline.tolerancePct / 100)) {
        grammars[g] = { ...grammars[g], instructionsPerParse: m.marginal };
      }
    }
    writeFileSync(baselinePath, `${JSON.stringify({ ...baseline, grammars }, null, 2)}\n`);
    console.log(`\nLowered ${unbanked.length} baseline value(s) in ${BASELINE}.`);
    return;
  }
  for (const line of [...failures, ...unbanked]) {
    console.error(`✗ ${line}`);
  }
  if (failures.length > 0 || unbanked.length > 0) {
    console.error('\nGrammar speed gate FAILED.');
    process.exit(1);
  }
  console.log(`\nGrammar speed gate passed: every grammar within ${baseline.tolerancePct}% of its baseline; self-test caught a doctored baseline.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(join(ROOT, BASELINE))) {
    console.error(`missing ${BASELINE}`);
    process.exit(1);
  }
  await main();
}
