#!/usr/bin/env node
/**
 * Real-world SCSS parse cost: function calls and marginal instructions per pass
 * over each vendored library (`packages/jess/benchmark/scss-real/`), AST and
 * CST, with the generated `gen-workload` beside them. `docs/perf/BENCHMARKS.md`
 * says what each fixture stands for.
 *
 * It runs `scss-parser/test/parse-bench.mjs`, which refuses a file that does not
 * parse whole, so a refusal ends this run too. The instruction count is the
 * canonical marginal, `(I(N2) − I(N1)) / (N2 − N1)`, on the default runtime with
 * the grammar speed gate's counter. The total row is the sum of the libraries.
 *
 *   pnpm run bench:scss:real
 *   pnpm run bench:scss:real --base <built checkout>   before/after, with A/A
 *   pnpm run bench:scss:real --jitless                 labelled diagnostic, N 2 → 6
 *   --n1 N --n2 N --reps N
 *
 * `--base` needs a checkout that holds this harness's fixtures and bench.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTERS } from './grammar-speed-gate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BENCH = 'packages/syntax/scss/scss-parser/test/parse-bench.mjs';
const LIBRARIES = ['bootstrap-5.3.8', 'foundation-6.9.0'];
const CASES = [...LIBRARIES, 'gen-workload'];
const SURFACES = ['ast', 'cst'];
const POOL = 4;

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const jitless = process.argv.includes('--jitless');
const n1 = Number(arg('n1', jitless ? 2 : 100));
const n2 = Number(arg('n2', jitless ? 6 : 300));
const reps = Number(arg('reps', 3));
const flags = jitless ? ['--jitless', '--single-threaded', '--predictable-gc-schedule'] : [];
const base = arg('base');
const ARMS = base
  ? [['head', ROOT], ['base', resolve(base)], ['base again', resolve(base)]]
  : [['head', ROOT]];
const counter = COUNTERS[process.platform];

/** One bench process: its row, and its instruction count when `counted`. */
function run(root, name, surface, warmup, timed, counted) {
  const node = [process.execPath, ...(counted ? flags : []), join(root, BENCH), 'report', String(warmup), String(timed)];
  const [cmd, argv] = counted ? counter.command(node) : [node[0], node.slice(1)];
  return new Promise((done, fail) => {
    const child = spawn(cmd, argv, {
      env: { ...process.env, BENCH_CASES: name, BENCH_SURFACES: surface, ...(counted ? {} : { BENCH_CALLS: '1' }) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('error', fail);
    child.on('close', (code) => {
      const row = code === 0 ? JSON.parse(stdout.trim().split('\n').at(-1)).out[`${name}/${surface}`] : undefined;
      const instructions = counted ? counter.read(stderr) : 0;
      if (!row || instructions === undefined) {
        fail(new Error(`${name}/${surface} in ${root}: exit ${code}\n${stderr.slice(-2000)}`));
      } else {
        done({ row, instructions: Number(instructions) });
      }
    });
  });
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure() {
  const jobs = [];
  const rows = new Map();
  const counts = new Map();
  for (const [arm, root] of ARMS) {
    for (const name of CASES) {
      for (const surface of SURFACES) {
        const key = `${arm}/${name}/${surface}`;
        jobs.push(async () => {
          rows.set(key, (await run(root, name, surface, 1, 3, false)).row);
        });
        for (let rep = 0; rep < reps; rep++) {
          for (const n of rep % 2 === 0 ? [n1, n2] : [n2, n1]) {
            jobs.push(async () => {
              counts.set(`${key}/${rep}/${n}`, (await run(root, name, surface, 0, n, true)).instructions);
            });
          }
        }
      }
    }
  }
  let next = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (next < jobs.length) {
      await jobs[next++]();
    }
  }));
  return { rows, counts };
}

/** `{ arm: { fixture: { surface: { files, kb, calls, instructions, spreadPct } } } }`, with the total. */
function summarize({ rows, counts }) {
  const out = {};
  for (const [arm] of ARMS) {
    out[arm] = {};
    for (const name of CASES) {
      out[arm][name] = {};
      for (const surface of SURFACES) {
        const key = `${arm}/${name}/${surface}`;
        const marginals = Array.from({ length: reps }, (_, rep) => (counts.get(`${key}/${rep}/${n2}`) - counts.get(`${key}/${rep}/${n1}`)) / (n2 - n1));
        const instructions = median(marginals);
        const { files, kb, calls } = rows.get(key);
        out[arm][name][surface] = { files, kb, calls, instructions, spreadPct: (Math.max(...marginals) - Math.min(...marginals)) / instructions * 100 };
      }
    }
    out[arm].total = Object.fromEntries(SURFACES.map((surface) => {
      const parts = LIBRARIES.map(name => out[arm][name][surface]);
      const sum = field => parts.reduce((total, part) => total + part[field], 0);
      return [surface, { files: sum('files'), kb: sum('kb'), calls: sum('calls'), instructions: sum('instructions'), spreadPct: Math.max(...parts.map(part => part.spreadPct)) }];
    }));
  }
  return out;
}

const LABEL = { 'gen-workload': 'gen-workload (generated)' };
const FIXTURES = [...LIBRARIES, 'total', 'gen-workload'];
const millions = value => `${(value / 1e6).toFixed(1)}M`;
const percent = (now, was) => `${((now / was - 1) * 100).toFixed(2)}%`;

const summary = summarize(await measure());
console.log(`SCSS parse cost per pass over a fixture's files. Marginal ${counter.id}, N ${n1} → ${n2}, median of ${reps}, ${jitless ? '--jitless (a diagnostic, not the default runtime)' : 'default runtime'}, ${process.platform}-${process.arch}, node ${process.version}.\n`);
console.log('| Arm | Fixture | Files | KB | Surface | Calls | Instructions | Per KB | Reps spread |\n|---|---|--:|--:|---|--:|--:|--:|--:|');
for (const [arm] of ARMS) {
  for (const name of FIXTURES) {
    for (const surface of SURFACES) {
      const m = summary[arm][name][surface];
      console.log(`| ${arm} | ${LABEL[name] ?? name} | ${m.files} | ${m.kb.toFixed(1)} | ${surface} | ${m.calls.toLocaleString('en-US')} | ${millions(m.instructions)} | ${millions(m.instructions / m.kb)} | ${m.spreadPct.toFixed(2)}% |`);
    }
  }
}
if (base) {
  console.log('\n| Fixture | Surface | Calls, head vs base | Instructions, head vs base | Instructions, A/A |\n|---|---|--:|--:|--:|');
  for (const name of FIXTURES) {
    for (const surface of SURFACES) {
      const [head, was, again] = ['head', 'base', 'base again'].map(arm => summary[arm][name][surface]);
      console.log(`| ${LABEL[name] ?? name} | ${surface} | ${percent(head.calls, was.calls)} | ${percent(head.instructions, was.instructions)} | ${percent(again.instructions, was.instructions)} |`);
    }
  }
}
