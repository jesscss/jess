#!/usr/bin/env node
/**
 * Compares two jess builds (each a checkout whose packages are built to `lib/`).
 *
 * Paired timing of one fixture (the default mode):
 *
 *   node scripts/compare-less-builds.mjs --before-root <dir> --after-root <dir> --fixture <file.less>
 *     [--phase parse-render|render] [--pairs 45] [--warmup 20] [--json]
 *
 * Corpus byte identity (`--corpus`): renders every stylesheet in
 * `packages/jess/test/{less,scss,jess,fixtures,files}`, the Less corpus
 * (`tests-unit` and `tests-config` under `$LESS_TEST_DATA_ROOT`, which includes
 * `3rd-party/bootstrap4.less`) and `packages/jess/benchmark/benchmark.less`, in
 * six output modes: `collapseNesting` false / 'native' / 'compact' × `compress`
 * off / on. Each render is recorded as the sha256 of its CSS (and source map),
 * plus its error and warning codes; a render that throws is recorded by its
 * error code. The two builds are compared as named sets per mode: every added,
 * removed and changed fixture is listed by name, and any of them exits 1.
 *
 *   # two builds side by side
 *   node scripts/compare-less-builds.mjs --corpus --before-root <dir> [--after-root <dir>]
 *   # one checkout: record before the change, compare after rebuilding
 *   node scripts/compare-less-builds.mjs --corpus --record .scratch/corpus-baseline.json
 *   node scripts/compare-less-builds.mjs --corpus --baseline .scratch/corpus-baseline.json
 *
 * `--after-root` defaults to this checkout. Fixture inputs always come from this
 * checkout, so both builds render the same files. `--filter <regex>` narrows the
 * fixtures by name (a baseline is narrowed the same way, so a full baseline
 * serves filtered runs); `--json` prints the diff as JSON.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VALUE_ARGS = ['before-root', 'after-root', 'fixture', 'phase', 'pairs', 'warmup', 'record', 'baseline', 'filter'];

export function parseArgs(argv) {
  const options = { phase: 'parse-render', pairs: 45, warmup: 20, json: false, corpus: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    }
    if (arg === '--json' || arg === '--corpus') {
      options[arg.slice(2)] = true;
      continue;
    }
    const key = arg.startsWith('--') ? arg.slice(2) : '';
    if (!VALUE_ARGS.includes(key)) {
      throw new Error(`Unknown arg: ${arg}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    if (key === 'pairs' || key === 'warmup') {
      options[key] = Number(value);
      if (!Number.isInteger(options[key]) || options[key] < 0) {
        throw new Error(`${arg} must be a non-negative integer`);
      }
    } else {
      options[key] = value;
    }
  }
  if (options.corpus) {
    options['after-root'] ??= REPO_ROOT;
    if (options['before-root'] && options.baseline) {
      throw new Error('--before-root and --baseline are alternatives');
    }
    if (!options['before-root'] && !options.baseline && !options.record) {
      throw new Error('--corpus needs --before-root, --baseline or --record');
    }
    return options;
  }
  if (!options['before-root'] || !options['after-root'] || !options.fixture) {
    throw new Error('--before-root, --after-root, and --fixture are required');
  }
  if (!['parse-render', 'render'].includes(options.phase)) {
    throw new Error('--phase must be parse-render or render');
  }
  return options;
}

const sha256 = text => createHash('sha256').update(text).digest('hex');

function outputDigest(output) {
  return { bytes: Buffer.byteLength(output), sha256: sha256(output) };
}

/* --- Corpus byte identity --- */

export const CORPUS_MODES = [false, 'native', 'compact'].flatMap(collapseNesting =>
  [false, true].map(compress => ({
    label: `collapseNesting=${collapseNesting},compress=${compress}`,
    collapseNesting,
    compress
  })));

const STYLESHEET = /\.(?:less|scss|sass|jess)$/;
const JESS_TEST_DIRS = ['less', 'scss', 'jess', 'fixtures', 'files'].map(dir => `packages/jess/test/${dir}`);
const TEST_DATA_DIRS = ['tests-unit', 'tests-config'];
const TEST_DATA_PREFIX = '@less/test-data/';

/** The same lookup order as `resolveLessTestDataRoot` in packages/jess/test/test-utils.ts. */
function resolveLessTestDataRoot() {
  const candidates = [process.env.LESS_TEST_DATA_ROOT];
  try {
    candidates.push(path.dirname(createRequire(path.join(REPO_ROOT, 'package.json')).resolve('@less/test-data')));
  } catch {
    // Fall through to the sibling checkout.
  }
  candidates.push(path.resolve(REPO_ROOT, '../less.js/packages/test-data'));
  const found = candidates.find(dir => dir && fs.existsSync(dir));
  if (!found) {
    throw new Error('Unable to resolve @less/test-data. Set LESS_TEST_DATA_ROOT to the Less.js packages/test-data directory.');
  }
  return fs.realpathSync(found);
}

function stylesheetsUnder(dir) {
  return fs.readdirSync(dir, { recursive: true })
    .filter(rel => STYLESHEET.test(rel))
    .map(rel => path.join(dir, rel));
}

/** Every corpus input as `{ name, file }`, sorted by name. */
export function corpusFixtures(testDataRoot, filter) {
  const fixtures = [
    ...JESS_TEST_DIRS.flatMap(dir => stylesheetsUnder(path.join(REPO_ROOT, dir)))
      .map(file => ({ name: path.relative(REPO_ROOT, file), file })),
    ...TEST_DATA_DIRS.flatMap(dir => stylesheetsUnder(path.join(testDataRoot, dir)))
      .map(file => ({ name: TEST_DATA_PREFIX + path.relative(testDataRoot, file), file, testData: true })),
    { name: 'packages/jess/benchmark/benchmark.less', file: path.join(REPO_ROOT, 'packages/jess/benchmark/benchmark.less') }
  ];
  const pattern = filter === undefined ? undefined : new RegExp(filter);
  return fixtures
    .filter(({ name }) => pattern === undefined || pattern.test(name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/*
 * The harness plugins the Less corpus suite renders with
 * (packages/jess/test/test-utils.ts), bound to the build under test, so the
 * corpus renders here the way it renders in `all-less.test.ts`.
 * ponytail: a plain-JS mirror because the script runs on built libs without a TS
 * loader. If the suite's harness changes, a fixture may render differently here,
 * which changes coverage but never the before/after comparison.
 */
function readNumericArg(value) {
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.value?.number === 'number') {
    return value.value.number;
  }
  return Number(value?.valueOf?.() ?? value);
}

function readStringArg(value) {
  const raw = typeof value?.value === 'string'
    ? value.value
    : typeof value?.value?.value === 'string' ? value.value.value : String(value?.valueOf?.() ?? value);
  return raw.replace(/^(['"])(.*)\1$/, '$2');
}

const harnessFunctionsPlugin = {
  install(less) {
    less.functions.functionRegistry.addMultiple({
      add: (a, b) => readNumericArg(a) + readNumericArg(b),
      increment: a => readNumericArg(a) + 1,
      _color: str => (readStringArg(str) === 'evil red' ? '#660000' : undefined)
    });
  }
};

function fixturePackagesPlugin() {
  const depsRoot = path.join(REPO_ROOT, 'packages/less-corpus-fixture-deps');
  const depsRequire = createRequire(path.join(depsRoot, '__jess_fixture_resolve__.js'));
  const { dependencies = {} } = JSON.parse(fs.readFileSync(path.join(depsRoot, 'package.json'), 'utf8'));
  const pinned = Object.keys(dependencies).map(name => [name, path.dirname(depsRequire.resolve(`${name}/package.json`))]);
  return {
    name: 'less-corpus-fixture-packages',
    resolve(filePath) {
      return (Array.isArray(filePath) ? filePath : [filePath]).map((candidate) => {
        for (const [name, dir] of pinned) {
          const marker = `${path.sep}${name}${path.sep}`;
          const at = candidate.lastIndexOf(marker);
          if (at !== -1) {
            return path.join(dir, candidate.slice(at + marker.length));
          }
          if (candidate.startsWith(`${name}/`)) {
            return path.join(dir, candidate.slice(name.length + 1));
          }
        }
        return candidate;
      });
    }
  };
}

function testDataRemoteImports(remoteImportPlugin, testDataRoot) {
  const published = '/npm/@less/test-data/';
  return remoteImportPlugin({
    allow: ['cdn.jsdelivr.net'],
    fetch: async (url) => {
      const { pathname } = new URL(url);
      const file = pathname.startsWith(published) ? path.join(testDataRoot, pathname.slice(published.length)) : undefined;
      return file !== undefined && fs.existsSync(file)
        ? new Response(fs.readFileSync(file, 'utf8'))
        : new Response('not found', { status: 404 });
    }
  });
}

const RENDER_TIMEOUT_MS = 60_000;

async function renderRecord(compiler, file, renderOptions) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'timeout' })), RENDER_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([compiler.renderToResult(file, renderOptions), timeout]);
    const record = { sha256: sha256(result.css), bytes: Buffer.byteLength(result.css) };
    if (result.map !== undefined) {
      record.map = sha256(result.map);
    }
    if (result.errors.length > 0) {
      record.errors = result.errors.map(diagnostic => diagnostic.code);
    }
    if (result.warnings.length > 0) {
      record.warnings = result.warnings.map(diagnostic => diagnostic.code);
    }
    return record;
  } catch (error) {
    return { thrown: String(error?.code ?? error?.name ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Renders every fixture in every mode with the build at `root`: `{ [mode]: { [name]: record } }`. */
async function renderCorpus(root, fixtures, testDataRoot) {
  const load = relative => import(pathToFileURL(path.resolve(root, relative)).href);
  const [{ Compiler }, { default: lessPlugin }, { lessCompatPlugin }, { remoteImportPlugin }] = await Promise.all([
    load('packages/jess/lib/index.js'),
    load('packages/syntax/less/jess-plugin-less/lib/index.js'),
    load('packages/syntax/less/jess-plugin-less-compat/lib/index.js'),
    load('packages/jess-plugin-remote-import/lib/index.js')
  ]);
  const plugins = [
    lessPlugin({ plugins: [harnessFunctionsPlugin] }),
    lessCompatPlugin(),
    fixturePackagesPlugin(),
    testDataRemoteImports(remoteImportPlugin, testDataRoot)
  ];
  const modes = {};
  for (const { label, collapseNesting, compress } of CORPUS_MODES) {
    /*
     * The mode goes in as a file-less `output` array entry: that is the shape
     * that overrides a fixture's own `styles.config` output, including one that
     * is itself an array of per-file entries. An `output` object merges onto
     * such an array as ignored properties, so the fixture's setting would win.
     */
    const compiler = new Compiler({ output: [{ collapseNesting, compress }], compile: { plugins } });
    const records = {};
    for (const { name, file, testData } of fixtures) {
      /*
       * Corpus `@plugin` fixtures load shared scripts from sibling directories,
       * so the suite widens their script read root to the corpus root.
       */
      records[name] = await renderRecord(compiler, file, testData ? { compile: { jsReadRoot: testDataRoot } } : undefined);
    }
    modes[label] = records;
  }
  return modes;
}

/** Compares two `{ [name]: record }` sets by name; a record's fields are compared one by one. */
export function diffNamedSets(before, after) {
  const added = Object.keys(after).filter(name => !Object.hasOwn(before, name)).sort();
  const removed = Object.keys(before).filter(name => !Object.hasOwn(after, name)).sort();
  const changed = Object.keys(after)
    .filter(name => Object.hasOwn(before, name))
    .sort()
    .flatMap((name) => {
      const keys = new Set([...Object.keys(before[name]), ...Object.keys(after[name])]);
      const fields = [...keys]
        .filter(key => JSON.stringify(before[name][key]) !== JSON.stringify(after[name][key]))
        .sort();
      return fields.length === 0 ? [] : [{ name, fields, before: before[name], after: after[name] }];
    });
  return { added, removed, changed };
}

/** Compares two `{ [mode]: { [name]: record } }` manifests mode by mode. */
export function diffCorpus(before, after) {
  const labels = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const modes = Object.fromEntries(labels.map(label => [label, diffNamedSets(before[label] ?? {}, after[label] ?? {})]));
  const identical = Object.values(modes).every(diff =>
    diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0);
  return { identical, modes };
}

function describeChange({ fields, before, after }) {
  const parts = [];
  if (fields.includes('sha256') || fields.includes('bytes')) {
    parts.push(`css differs ${before.bytes ?? '-'}B -> ${after.bytes ?? '-'}B`);
  }
  if (fields.includes('map')) {
    parts.push('source map');
  }
  for (const field of fields.filter(field => !['sha256', 'bytes', 'map'].includes(field))) {
    parts.push(`${field} ${JSON.stringify(before[field] ?? null)} -> ${JSON.stringify(after[field] ?? null)}`);
  }
  return parts.join('; ');
}

export function formatCorpusDiff(diff) {
  const lines = [];
  for (const [label, { added, removed, changed }] of Object.entries(diff.modes)) {
    if (added.length + removed.length + changed.length === 0) {
      lines.push(`${label}: identical`);
      continue;
    }
    lines.push(`${label}:`);
    lines.push(...added.map(name => `  added    ${name}`));
    lines.push(...removed.map(name => `  removed  ${name}`));
    lines.push(...changed.map(change => `  changed  ${change.name} (${describeChange(change)})`));
  }
  lines.push(`byteIdentical=${diff.identical}`);
  return lines.join('\n');
}

function gitCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

async function timedRender(root, fixtures, testDataRoot) {
  const started = performance.now();
  const modes = await renderCorpus(root, fixtures, testDataRoot);
  const seconds = (performance.now() - started) / 1000;
  console.error(`rendered ${fixtures.length} fixtures x ${CORPUS_MODES.length} modes with ${root} in ${seconds.toFixed(1)}s`);
  return modes;
}

async function runCorpus(options) {
  const testDataRoot = resolveLessTestDataRoot();
  const fixtures = corpusFixtures(testDataRoot, options.filter);
  const afterRoot = path.resolve(options['after-root']);
  const meta = { root: afterRoot, commit: gitCommit(afterRoot), testDataRoot, testDataCommit: gitCommit(testDataRoot) };

  let before;
  let beforeMeta;
  if (options.baseline) {
    ({ meta: beforeMeta, modes: before } = JSON.parse(fs.readFileSync(options.baseline, 'utf8')));
    if (options.filter !== undefined) {
      const pattern = new RegExp(options.filter);
      before = Object.fromEntries(Object.entries(before).map(([label, records]) =>
        [label, Object.fromEntries(Object.entries(records).filter(([name]) => pattern.test(name)))]));
    }
  } else if (options['before-root']) {
    const beforeRoot = path.resolve(options['before-root']);
    beforeMeta = { root: beforeRoot, commit: gitCommit(beforeRoot), testDataRoot, testDataCommit: meta.testDataCommit };
    before = await timedRender(beforeRoot, fixtures, testDataRoot);
  }
  const after = await timedRender(afterRoot, fixtures, testDataRoot);

  if (options.record) {
    fs.mkdirSync(path.dirname(path.resolve(options.record)), { recursive: true });
    fs.writeFileSync(options.record, `${JSON.stringify({ meta, modes: after }, null, 1)}\n`);
    console.error(`recorded ${options.record}`);
  }
  if (before === undefined) {
    return 0;
  }
  if (beforeMeta.testDataCommit !== meta.testDataCommit) {
    console.error(`warning: the baseline was recorded against test-data ${beforeMeta.testDataCommit}, this run uses ${meta.testDataCommit}`);
  }
  const diff = diffCorpus(before, after);
  console.log(options.json
    ? JSON.stringify({ before: beforeMeta, after: meta, ...diff }, null, 2)
    : `before=${beforeMeta.root}@${beforeMeta.commit ?? '?'}\nafter=${afterRoot}@${meta.commit ?? '?'}\n${formatCorpusDiff(diff)}`);
  return diff.identical ? 0 : 1;
}

/* --- Paired timing of one fixture --- */

async function loadBuild(root) {
  const module = relative => import(pathToFileURL(path.resolve(root, relative)).href);
  const [{ serialize }, { Compiler }, { default: lessPlugin }, { lessCompatPlugin }] = await Promise.all([
    module('packages/core/lib/index.js'),
    module('packages/compiler/lib/index.js'),
    module('packages/syntax/less/jess-plugin-less/lib/index.js'),
    module('packages/syntax/less/jess-plugin-less-compat/lib/index.js')
  ]);
  return { Compiler, serialize, lessPlugin, lessCompatPlugin };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const index = (values.length - 1) * 0.5;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const median = sorted.length === 0
    ? 0
    : lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return { mean, median, min: sorted[0], max: sorted.at(-1) };
}

async function measure(build, fixture, phase) {
  const compiler = new build.Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [build.lessPlugin(), build.lessCompatPlugin()] },
    suppressWarnings: true
  });
  if (phase === 'parse-render') {
    const started = performance.now();
    const output = await compiler.render(fixture, { suppressWarnings: true });
    return { elapsedMs: performance.now() - started, output: outputDigest(output) };
  }
  const { document, context } = await compiler.compile(fixture, { suppressWarnings: true });
  const started = performance.now();
  const result = await context.withDocument(document, () => build.serialize(document, {
    collapseNesting: true,
    context,
    pluginHost: context.pluginHost,
    io: { readFile: specifier => context.readBinary(specifier).catch(() => null) }
  }));
  return { elapsedMs: performance.now() - started, output: outputDigest(result.css) };
}

async function runPaired(options) {
  const fixture = path.resolve(options.fixture);
  const before = await loadBuild(options['before-root']);
  const after = await loadBuild(options['after-root']);

  for (let i = 0; i < options.warmup; i++) {
    await measure(before, fixture, options.phase);
    await measure(after, fixture, options.phase);
  }

  const pairs = [];
  for (let i = 0; i < options.pairs; i++) {
    const afterFirst = i % 2 === 1;
    let beforeResult;
    let afterResult;
    if (afterFirst) {
      afterResult = await measure(after, fixture, options.phase);
      beforeResult = await measure(before, fixture, options.phase);
    } else {
      beforeResult = await measure(before, fixture, options.phase);
      afterResult = await measure(after, fixture, options.phase);
    }
    pairs.push({
      index: i + 1,
      order: afterFirst ? 'after-before' : 'before-after',
      beforeMs: beforeResult.elapsedMs,
      afterMs: afterResult.elapsedMs,
      deltaMs: afterResult.elapsedMs - beforeResult.elapsedMs,
      ratio: beforeResult.elapsedMs === 0 ? 0 : (afterResult.elapsedMs - beforeResult.elapsedMs) / beforeResult.elapsedMs,
      beforeOutput: beforeResult.output,
      afterOutput: afterResult.output
    });
  }

  const beforeSummary = summarize(pairs.map(pair => pair.beforeMs));
  const afterSummary = summarize(pairs.map(pair => pair.afterMs));
  const deltas = summarize(pairs.map(pair => pair.deltaMs));
  const wins = pairs.filter(pair => pair.afterMs < pair.beforeMs).length;
  const byteIdentical = pairs.every(pair =>
    pair.beforeOutput.bytes === pair.afterOutput.bytes
    && pair.beforeOutput.sha256 === pair.afterOutput.sha256);
  const result = {
    fixture,
    phase: options.phase,
    warmup: options.warmup,
    pairs: options.pairs,
    before: beforeSummary,
    after: afterSummary,
    deltas,
    medianRatioPercent: beforeSummary.median === 0 ? 0 : (afterSummary.median - beforeSummary.median) / beforeSummary.median * 100,
    wins,
    losses: pairs.length - wins,
    byteIdentical,
    output: pairs[0] ? { before: pairs[0].beforeOutput, after: pairs[0].afterOutput } : undefined
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`paired ${options.phase} build comparison fixture=${fixture}`);
    console.log(`before median=${beforeSummary.median.toFixed(2)}ms mean=${beforeSummary.mean.toFixed(2)}ms`);
    console.log(`after median=${afterSummary.median.toFixed(2)}ms mean=${afterSummary.mean.toFixed(2)}ms`);
    console.log(`delta median=${deltas.median.toFixed(2)}ms mean=${deltas.mean.toFixed(2)}ms ratio=${result.medianRatioPercent.toFixed(2)}% wins=${wins}/${pairs.length}`);
    console.log(`byteIdentical=${byteIdentical}`);
  }
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const code = options.corpus ? await runCorpus(options) : await runPaired(options);

  // Plugin workers (Deno for @plugin fixtures) can keep the event loop alive.
  process.exit(code);
}
