#!/usr/bin/env node
/**
 * CLI cold start, jess against lessc 4.x: every sample is a fresh process.
 *
 *   node scripts/measure-cli-cold-start.mjs [--runs 21] [--fixture benchmark|bootstrap4] [--base <jess checkout>]
 *
 * Measures, as the median over `--runs` interleaved rounds (arm order alternates
 * each round):
 *   cli     `jess <fixture> <out>` and `lessc <fixture> <out>`, spawn to exit
 *   load    importing what the CLI imports to compile, inside the process
 *   first   the first compile in a fresh process (after the load)
 *   second  the second compile in that process
 *
 * `--base` adds a second jess checkout (built) as its own arm, for before/after.
 * `bootstrap4` is the less.js corpus file rendered as the corpus renders it:
 * `bootstrap-less-port` from `packages/less-corpus-fixture-deps`, `math: 0` from
 * its styles.config; lessc gets `--math=always` and that package as an include
 * path, so both compile the same sources. Build first (`pnpm run build:release`).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const runs = Number(option('runs', '21'));
const fixtureName = option('fixture', 'benchmark');
const base = option('base');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cold-start-'));
const lesscBin = path.resolve(path.dirname(require.resolve('less')), '../bin/lessc');
let fixture;
let lesscArgs = [];
let lessOptions = {};
if (fixtureName === 'bootstrap4') {
  const corpus = path.join(path.dirname(require.resolve('@less/test-data/package.json')), 'tests-config/3rd-party');
  const deps = path.join(root, 'packages/less-corpus-fixture-deps/node_modules');
  fs.copyFileSync(path.join(corpus, 'bootstrap4.less'), path.join(scratch, 'bootstrap4.less'));
  fs.copyFileSync(path.join(corpus, 'styles.config.cjs'), path.join(scratch, 'styles.config.cjs'));
  fs.writeFileSync(path.join(scratch, 'package.json'), '{"private":true}\n');
  fs.symlinkSync(deps, path.join(scratch, 'node_modules'));
  fixture = path.join(scratch, 'bootstrap4.less');
  lesscArgs = ['--math=always', `--include-path=${deps}`];
  lessOptions = { math: 'always', paths: [deps] };
} else {
  fixture = path.join(root, 'packages/jess/benchmark/benchmark.less');
}

/** The in-process probe: load, then two compiles, as one JSON line on stdout. */
const jessProbe = checkout => `
const t0 = performance.now();
const [{ Compiler }] = await Promise.all([
  import(${JSON.stringify(path.join(checkout, 'packages/jess/lib/index.js'))}),
  import(${JSON.stringify(path.join(checkout, 'packages/jess/node_modules/@jesscss/core/lib/index.js'))}),
  import(${JSON.stringify(path.join(checkout, 'packages/jess/node_modules/@jesscss/compiler/lib/diagnostics.js'))})
]);
const t1 = performance.now();
const compiler = new Compiler();
await compiler.render(${JSON.stringify(fixture)}, { suppressWarnings: true });
const t2 = performance.now();
await compiler.render(${JSON.stringify(fixture)}, { suppressWarnings: true });
const t3 = performance.now();
console.log(JSON.stringify({ load: t1 - t0, first: t2 - t1, second: t3 - t2 }));
`;
const lessProbe = `
const t0 = performance.now();
const { default: less } = await import(${JSON.stringify(import.meta.resolve('less'))});
const t1 = performance.now();
const fs = await import('node:fs');
const render = () => less.render(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'), { filename: ${JSON.stringify(fixture)}, ...${JSON.stringify(lessOptions)} });
await render();
const t2 = performance.now();
await render();
const t3 = performance.now();
console.log(JSON.stringify({ load: t1 - t0, first: t2 - t1, second: t3 - t2 }));
`;

const out = path.join(scratch, 'out.css');
const arms = [
  { name: 'jess', cli: [path.join(root, 'packages/jess/bin/cli.mjs'), fixture, out], probe: jessProbe(root) },
  ...(base ? [{ name: 'jess-base', cli: [path.join(path.resolve(base), 'packages/jess/bin/cli.mjs'), fixture, out], probe: jessProbe(path.resolve(base)) }] : []),
  { name: 'lessc', cli: [lesscBin, ...lesscArgs, fixture, out], probe: lessProbe }
];

const run = (argv, input) => {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, argv, { cwd: path.dirname(fixture), input, encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.status !== 0) {
    throw new Error(`${argv.join(' ')} exited ${result.status}\n${result.stderr}`);
  }
  return { ms, stdout: result.stdout };
};

const samples = new Map(arms.map(arm => [arm.name, { cli: [], load: [], first: [], second: [] }]));
for (let round = 0; round < runs; round++) {
  const order = round % 2 === 0 ? arms : [...arms].reverse();
  for (const arm of order) {
    const sample = samples.get(arm.name);
    sample.cli.push(run(arm.cli).ms);
    const probe = JSON.parse(run(['--input-type=module', '-'], arm.probe).stdout.trim().split('\n').pop());
    for (const key of ['load', 'first', 'second']) {
      sample[key].push(probe[key]);
    }
  }
}
fs.rmSync(scratch, { recursive: true, force: true });

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
console.log(`${fixtureName}, ${runs} interleaved runs, node ${process.version}, median ms`);
console.log(['arm', 'cli', 'load', 'first', 'second'].map(cell => cell.padStart(10)).join(''));
for (const [name, sample] of samples) {
  console.log([name, ...['cli', 'load', 'first', 'second'].map(key => median(sample[key]).toFixed(1))].map(cell => cell.padStart(10)).join(''));
}
