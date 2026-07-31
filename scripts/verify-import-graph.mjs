#!/usr/bin/env node
/**
 * Eager-import-graph gate.
 *
 * Node's ESM loader does not tree-shake. Importing a module executes every
 * module reachable through its static import edges, so a single named import of
 * a plain const from a module that also imports a compiled grammar table costs
 * the whole table at load time. That is invisible to every other check here: it
 * is not a test failure, not an output diff, not a bundle-size fixture, and not
 * a parse-throughput regression. It only shows up as startup cost and resident
 * memory in the shipped product.
 *
 * This gate records, per published entry point, the exact set of workspace
 * modules Node eagerly loads and the external package names it reaches. Byte
 * totals move whenever a grammar is edited, so they are reported but not
 * gated; the module set is what encodes the intent — `@jesscss/less-parser`
 * loads the two Less AST grammar variants and nothing else.
 *
 *   node scripts/verify-import-graph.mjs           # check against the baseline
 *   node scripts/verify-import-graph.mjs --report   # print the current graphs
 *   node scripts/verify-import-graph.mjs --write    # re-record the baseline
 *
 * Re-recording is a deliberate act: it means an entry point's dependencies
 * genuinely changed, and the diff on the baseline file should say so.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');
const hooksEntry = path.join(rootDir, 'tools/import-graph/register.mjs');
const baselinePath = path.join(rootDir, 'scripts/import-graph.baseline.json');

/* Resolution happens from this package because it depends on all of them. */
const resolveFrom = path.join(rootDir, 'packages/jess');

const ENTRIES = [
  '@jesscss/core',
  '@jesscss/core/ast',
  '@jesscss/core/diagnostics',
  '@jesscss/core/value'
];
for (const dialect of ['css', 'less', 'scss', 'jess']) {
  ENTRIES.push(
    `@jesscss/${dialect}-parser`,
    `@jesscss/${dialect}-parser/cst`,
    `@jesscss/${dialect}-parser/grammar/ast`,
    `@jesscss/${dialect}-parser/grammar/ast/positions`,
    `@jesscss/${dialect}-parser/grammar/cst`,
    `@jesscss/${dialect}-parser/grammar/cst/positions`
  );
}
ENTRIES.push('@jesscss/css-parser/cst-host');
ENTRIES.sort();

/** `node_modules/.pnpm/<name>@<version>/node_modules/<name>/...` -> `<name>`. */
const PNPM_STORE = /node_modules\/\.pnpm\/(?:@([^+@/]+)\+)?([^@/]+)@/u;

function externalName(relativePath) {
  const match = PNPM_STORE.exec(relativePath);
  if (match === null) {
    return null;
  }
  return match[1] === undefined ? match[2] : `@${match[1]}/${match[2]}`;
}

function eagerGraph(specifier) {
  const outFile = path.join(
    fs.mkdtempSync(path.join(rootDir, 'node_modules/.import-graph-')),
    'urls.txt'
  );
  fs.writeFileSync(outFile, '');
  const result = spawnSync(
    process.execPath,
    [
      '--import', pathToFileURL(hooksEntry).href,
      '--input-type=module',
      '-e', `await import(${JSON.stringify(specifier)});`
    ],
    {
      cwd: resolveFrom,
      env: { ...process.env, JESS_IMPORT_GRAPH_OUT: outFile },
      encoding: 'utf8'
    }
  );
  if (result.status !== 0) {
    fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
    throw new Error(`cannot import ${specifier}:\n${result.stderr}`);
  }
  const urls = [...new Set(fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean))];
  fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
  const workspace = [];
  const externals = new Set();
  let bytes = 0;
  for (const url of urls) {
    const absolute = fileURLToPath(url);
    if (absolute.startsWith(path.join(rootDir, 'tools/import-graph'))) {
      continue;
    }
    bytes += fs.statSync(absolute).size;
    const relative = path.relative(rootDir, absolute).split(path.sep).join('/');
    const external = externalName(relative);
    if (external === null) {
      workspace.push(relative);
    } else {
      externals.add(external);
    }
  }
  return {
    modules: workspace.sort(),
    externals: [...externals].sort(),
    bytes
  };
}

function collect() {
  const graphs = {};
  for (const specifier of ENTRIES) {
    graphs[specifier] = eagerGraph(specifier);
  }
  return graphs;
}

function diffLists(expected, actual) {
  const added = actual.filter(item => !expected.includes(item));
  const removed = expected.filter(item => !actual.includes(item));
  return { added, removed };
}

const mode = process.argv.includes('--write')
  ? 'write'
  : process.argv.includes('--report') ? 'report' : 'check';

const graphs = collect();

if (mode === 'report') {
  for (const [specifier, graph] of Object.entries(graphs)) {
    console.log(`\n${specifier}  ${graph.bytes.toLocaleString()} B`);
    for (const module of graph.modules) {
      console.log(`  ${module}`);
    }
    for (const external of graph.externals) {
      console.log(`  (external) ${external}`);
    }
  }
  process.exit(0);
}

if (mode === 'write') {
  fs.writeFileSync(baselinePath, `${JSON.stringify(graphs, null, 2)}\n`);
  console.log(`Recorded ${Object.keys(graphs).length} entry points to ${path.relative(rootDir, baselinePath)}`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing ${path.relative(rootDir, baselinePath)}. Run with --write to record it.`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const failures = [];

for (const specifier of new Set([...Object.keys(baseline), ...Object.keys(graphs)])) {
  const expected = baseline[specifier];
  const actual = graphs[specifier];
  if (expected === undefined) {
    failures.push(`${specifier}: new entry point is not in the baseline.`);
    continue;
  }
  if (actual === undefined) {
    failures.push(`${specifier}: baseline entry point no longer resolves.`);
    continue;
  }
  const modules = diffLists(expected.modules, actual.modules);
  const externals = diffLists(expected.externals, actual.externals);
  if (modules.added.length + modules.removed.length + externals.added.length + externals.removed.length === 0) {
    continue;
  }
  const lines = [`${specifier}: eager import graph changed (${expected.bytes.toLocaleString()} -> ${actual.bytes.toLocaleString()} B).`];
  for (const module of modules.added) {
    lines.push(`  + ${module}`);
  }
  for (const module of modules.removed) {
    lines.push(`  - ${module}`);
  }
  for (const external of externals.added) {
    lines.push(`  + (external) ${external}`);
  }
  for (const external of externals.removed) {
    lines.push(`  - (external) ${external}`);
  }
  failures.push(lines.join('\n'));
}

if (failures.length > 0) {
  console.error('Eager import graph differs from the recorded baseline.\n');
  console.error(failures.join('\n\n'));
  console.error(
    '\nAdding a module here costs every consumer of that entry point its full '
    + 'load time, because Node does not tree-shake. If the new edge is '
    + 'intended, re-record with: node scripts/verify-import-graph.mjs --write'
  );
  process.exit(1);
}

console.log(`Eager import graph matches the baseline for ${Object.keys(graphs).length} entry points.`);
