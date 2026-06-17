#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const lessPkgRoot = path.resolve(repoRoot, '../less.js/packages/less');
const benchDir = path.join(lessPkgRoot, 'benchmark');
const preloadPath = path.join(__dirname, 'deno-proof-preload.mjs');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.split('=');
    return [key, value];
  })
);

const files = (args.get('--files') ?? 'benchmark.less,benchmark-v3.less,benchmark-v37.less,benchmark-v39.less')
  .split(',')
  .map(file => file.trim())
  .filter(Boolean);
const runs = Number(args.get('--runs') ?? 1);
const warmup = Number(args.get('--warmup') ?? 0);
const keepTemp = args.get('--keep-temp') === 'true';
const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-deno-proof-'));

const historicalFile = path.join(benchDir, 'results', 'latest', 'macbook-pro_arm64.json');
const historical = fs.existsSync(historicalFile)
  ? JSON.parse(fs.readFileSync(historicalFile, 'utf8'))
  : null;
const historicalLess = historical?.versions?.find(version => version.version?.startsWith('4.5'))
  ?? historical?.versions?.filter(version => version.version?.startsWith('4.')).pop()
  ?? null;

function proofEnv(label, extra = {}) {
  const proofBase = path.join(proofDir, label);
  const importOpt = `--import=${preloadPath}`;
  const nodeOptions = process.env.NODE_OPTIONS
    ? `${process.env.NODE_OPTIONS} ${importOpt}`
    : importOpt;
  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    JESS_DENO_PROOF_FILE: proofBase,
    ...extra
  };
}

function readProof(label) {
  const prefix = `${label}.`;
  const records = fs.readdirSync(proofDir)
    .filter(file => file.startsWith(prefix) && file.endsWith('.json'))
    .map(file => JSON.parse(fs.readFileSync(path.join(proofDir, file), 'utf8')));
  return records.reduce((total, record) => {
    total.processes++;
    total.pluginJsResolve += record.pluginJsResolve ?? 0;
    total.pluginJsRequire += record.pluginJsRequire ?? 0;
    total.denoSpawn += record.denoSpawn ?? 0;
    total.denoSpawnSync += record.denoSpawnSync ?? 0;
    total.denoExecFile += record.denoExecFile ?? 0;
    total.denoExecFileSync += record.denoExecFileSync ?? 0;
    total.brokerEnvSpawns += record.brokerEnvSpawns ?? 0;
    total.commands.push(...(record.commands ?? []));
    return total;
  }, {
    processes: 0,
    pluginJsResolve: 0,
    pluginJsRequire: 0,
    denoSpawn: 0,
    denoSpawnSync: 0,
    denoExecFile: 0,
    denoExecFileSync: 0,
    brokerEnvSpawns: 0,
    commands: []
  });
}

function runNode(label, nodeArgs, options = {}) {
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: options.cwd ?? repoRoot,
    env: proofEnv(label, options.env),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  const proof = readProof(label);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    proof
  };
}

function assertNoDeno(label, proof) {
  const totalDeno =
    proof.pluginJsResolve
    + proof.pluginJsRequire
    + proof.denoSpawn
    + proof.denoSpawnSync
    + proof.denoExecFile
    + proof.denoExecFileSync
    + proof.brokerEnvSpawns;
  if (totalDeno !== 0) {
    throw new Error(`${label} unexpectedly touched plugin-js/Deno: ${JSON.stringify(proof, null, 2)}`);
  }
}

function assertDenoObserved(label, proof) {
  const totalDeno =
    proof.pluginJsResolve
    + proof.pluginJsRequire
    + proof.denoSpawn
    + proof.denoSpawnSync
    + proof.denoExecFile
    + proof.denoExecFileSync
    + proof.brokerEnvSpawns;
  if (totalDeno === 0) {
    throw new Error(`${label} did not trigger plugin-js/Deno instrumentation`);
  }
}

function parseJsonOutput(label, stdout, stderr) {
  try {
    return JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`${label} did not emit JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}\n${err}`);
  }
}

const benchmarkResults = [];
for (const file of files) {
  const label = `benchmark-${file.replace(/[^a-z0-9_.-]/gi, '_')}`;
  const benchmarkFile = path.join(benchDir, file);
  const result = runNode(label, [
    path.join(benchDir, 'benchmark-runner.cjs'),
    benchmarkFile,
    `--runs=${runs}`,
    `--warmup=${warmup}`,
    '--math=parens-division'
  ], {
    cwd: lessPkgRoot
  });
  if (result.status !== 0) {
    throw new Error(`${file} benchmark failed with status ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const parsed = parseJsonOutput(file, result.stdout, result.stderr);
  assertNoDeno(file, result.proof);
  benchmarkResults.push({
    file,
    renderAvgMs: parsed.render?.avg ?? null,
    renderMedianMs: parsed.render?.median ?? null,
    sourceGraphIsPluginFree: parsed.sourceGraphIsPluginFree,
    proof: result.proof,
    historicalLessAvgMs: historicalLess?.benchmarks?.[file]?.render?.avg ?? null
  });
}

const sourceMapProbe = runNode('source-map-probe', [
  '--input-type=module',
  '--eval',
  [
    'import fs from "node:fs";',
    'import path from "node:path";',
    `const less = (await import(${JSON.stringify(path.join(lessPkgRoot, 'lib/index.js'))})).default;`,
    `const file = ${JSON.stringify(path.join(benchDir, files[0]))};`,
    'const source = fs.readFileSync(file, "utf8");',
    'const result = await less.render(source, { filename: file, paths: [path.dirname(file)], math: "parens-division" });',
    'console.log(JSON.stringify({ hasMap: Object.prototype.hasOwnProperty.call(result, "map"), keys: Object.keys(result).sort() }));'
  ].join('\n')
], {
  cwd: lessPkgRoot
});
if (sourceMapProbe.status !== 0) {
  throw new Error(`source map probe failed\nstdout:\n${sourceMapProbe.stdout}\nstderr:\n${sourceMapProbe.stderr}`);
}
const sourceMapResult = parseJsonOutput('source-map-probe', sourceMapProbe.stdout, sourceMapProbe.stderr);
assertNoDeno('source-map-probe', sourceMapProbe.proof);
if (sourceMapResult.hasMap) {
  throw new Error(`source-map-probe unexpectedly returned a map: ${JSON.stringify(sourceMapResult)}`);
}

const controlRoot = fs.mkdtempSync(path.join(proofDir, 'control-'));
const controlResult = runNode('positive-control', [
  '--input-type=module',
  '--eval',
  [
    'import fs from "node:fs";',
    'import path from "node:path";',
    `const root = ${JSON.stringify(controlRoot)};`,
    'const pluginPath = path.join(root, "control-plugin.js");',
    'const lessPath = path.join(root, "control.less");',
    'fs.writeFileSync(pluginPath, [',
    '  "registerPlugin({",',
    '  "  install: function(_less, _manager, functions) {",',
    '  "    functions.add(\\"probe\\", function() {",',
    '  "      return typeof process === \\"undefined\\" ? \\"DENIED\\" : \\"LEAKED\\";",',
    '  "    });",',
    '  "  }",',
    '  "});"',
    '].join("\\n"), "utf8");',
    'fs.writeFileSync(lessPath, ["@plugin \\"./control-plugin.js\\";", ".x { value: probe(); }"].join("\\n"), "utf8");',
    `const { Compiler } = await import(${JSON.stringify(path.join(repoRoot, 'packages/jess/lib/index.js'))});`,
    `const lessPlugin = (await import(${JSON.stringify(path.join(repoRoot, 'packages/jess-plugin-less/lib/index.js'))})).default;`,
    `const { lessCompatPlugin } = await import(${JSON.stringify(path.join(repoRoot, 'packages/jess-plugin-less-compat/lib/index.js'))});`,
    'const compiler = new Compiler({',
    '  output: { collapseNesting: true },',
    '  compile: { plugins: ["@jesscss/plugin-js", lessPlugin(), lessCompatPlugin()] }',
    '});',
    'const result = await compiler.renderToResult(lessPath, { suppressWarnings: true });',
    'console.log(JSON.stringify({ css: result.css, errors: result.errors.map(error => error.message) }));'
  ].join('\n')
]);
if (controlResult.status !== 0) {
  throw new Error(`positive control failed\nstdout:\n${controlResult.stdout}\nstderr:\n${controlResult.stderr}`);
}
const controlParsed = parseJsonOutput('positive-control', controlResult.stdout, controlResult.stderr);
assertDenoObserved('positive-control', controlResult.proof);

const proof = {
  type: 'less-v5-deno-benchmark-proof',
  timestamp: new Date().toISOString(),
  lessPackageRoot: lessPkgRoot,
  runs,
  warmup,
  historicalFile: fs.existsSync(historicalFile) ? historicalFile : null,
  historicalVersion: historicalLess?.version ?? null,
  benchmarks: benchmarkResults,
  sourceMapProbe: {
    result: sourceMapResult,
    proof: sourceMapProbe.proof
  },
  positiveControl: {
    result: controlParsed,
    proof: controlResult.proof
  },
  proofDir: keepTemp ? proofDir : undefined
};

console.log(JSON.stringify(proof, null, 2));

if (!keepTemp) {
  fs.rmSync(proofDir, { recursive: true, force: true });
}
