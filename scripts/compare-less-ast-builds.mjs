#!/usr/bin/env node

/**
 * Reproducibly compare two direct-Less AST parser commits.
 *
 * This is deliberately a commit-replay tool, not a "point at two worktrees"
 * tool. It archives each commit into the same disposable directory, builds it
 * there twice, and only then measures its retained bundle. That gives both
 * builds the same absolute source path and module-resolution topology, so an
 * emitted path-dependent identifier cannot masquerade as a parser delta.
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageMarker = 'jess-less-ast-compare-stage-v1\n';
const stageName = 'jess-less-ast-compare-stage';
const allowedChangedFiles = new Set([
  'docs/future/core-architecture/PERF_IDEAS.md',
  'packages/less-parser/src/ast/grammar.ts'
]);

function usage(message) {
  if (message) {
    console.error(`Error: ${message}`);
  }
  console.error('Usage: node scripts/compare-less-ast-builds.mjs --before <commit> --after <commit> --fixture <repo-relative-less-file> [--stage-root <tmp-dir>] [--warmup N] [--pairs N] [--json]');
  process.exitCode = 1;
}

function readNonNegativeInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`${flag} must be a non-negative integer`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    warmup: 20,
    pairs: 45,
    json: false,
    stageRoot: path.join(os.tmpdir(), stageName)
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--json') {
      options.json = true;
      continue;
    }
    if (!['--before', '--after', '--fixture', '--stage-root', '--warmup', '--pairs'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === '--warmup' || flag === '--pairs') {
      options[flag.slice(2)] = readNonNegativeInteger(value, flag);
    } else if (flag === '--stage-root') {
      options.stageRoot = value;
    } else {
      options[flag.slice(2)] = value;
    }
  }
  if (!options.before || !options.after || !options.fixture) {
    throw new Error('--before, --after, and --fixture are required');
  }
  if (options.pairs < 1) {
    throw new Error('--pairs must be at least one');
  }
  if (path.isAbsolute(options.fixture) || options.fixture.split(path.sep).includes('..')) {
    throw new Error('--fixture must be a repository-relative path without `..`');
  }
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digestBuffer(value) {
  return { bytes: value.length, sha256: sha256(value) };
}

function digestFile(file) {
  return digestBuffer(fs.readFileSync(file));
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function resolveCommit(ref) {
  return git(['rev-parse', `${ref}^{commit}`]).trim();
}

function readCommitFile(commit, file) {
  return git(['show', `${commit}:${file}`], { encoding: 'buffer' });
}

function assertComparable(before, after, fixture) {
  const changed = git(['diff', '--name-only', before, after])
    .trim()
    .split('\n')
    .filter(Boolean);
  const unsupported = changed.filter(file => !allowedChangedFiles.has(file));
  if (unsupported.length > 0) {
    throw new Error(`This direct-Less parser protocol only admits grammar-only commits; unsupported changed paths: ${unsupported.join(', ')}`);
  }
  const beforeLock = readCommitFile(before, 'pnpm-lock.yaml');
  const afterLock = readCommitFile(after, 'pnpm-lock.yaml');
  if (!beforeLock.equals(afterLock)) {
    throw new Error('The compared commits have different pnpm locks, so they cannot share one dependency build.');
  }
  const beforeFixture = readCommitFile(before, fixture);
  const afterFixture = readCommitFile(after, fixture);
  if (!beforeFixture.equals(afterFixture)) {
    throw new Error(`The fixture changed between commits: ${fixture}`);
  }
  return { changed, input: beforeFixture, lock: digestBuffer(beforeLock) };
}

function canonicalStageRoot(value) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const stageRoot = path.resolve(value);
  const parent = fs.realpathSync(path.dirname(stageRoot));
  if (parent !== tempRoot || path.basename(stageRoot) !== stageName) {
    throw new Error(`--stage-root must be exactly one ${stageName} directory immediately under ${tempRoot}`);
  }
  return path.join(parent, stageName);
}

function prepareStage(stageRoot) {
  if (fs.existsSync(stageRoot)) {
    const marker = path.join(stageRoot, '.jess-stage-marker');
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== stageMarker) {
      throw new Error(`Refusing to remove an unowned stage directory: ${stageRoot}`);
    }
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.writeFileSync(path.join(stageRoot, '.jess-stage-marker'), stageMarker);
  fs.mkdirSync(path.join(stageRoot, '.benchmark-artifacts'), { recursive: true });
}

function cleanStageSource(stageRoot) {
  for (const entry of fs.readdirSync(stageRoot)) {
    if (entry === '.jess-stage-marker' || entry === '.benchmark-artifacts' || entry === 'node_modules') {
      continue;
    }
    fs.rmSync(path.join(stageRoot, entry), { recursive: true, force: true });
  }
}

function restoreCommit(stageRoot, commit) {
  cleanStageSource(stageRoot);
  const archive = git(['archive', '--format=tar', commit], { encoding: 'buffer' });
  const extracted = spawnSync('tar', ['-xf', '-', '-C', stageRoot], {
    input: archive,
    encoding: 'utf8'
  });
  if (extracted.status !== 0) {
    throw new Error(`Could not extract ${commit}: ${extracted.stderr || extracted.stdout || 'tar failed'}`);
  }
}

function runPnpm(stageRoot, args) {
  const result = spawnSync('pnpm', args, { cwd: stageRoot, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed for staged artifact`);
  }
}

function installStage(stageRoot) {
  runPnpm(stageRoot, ['install', '--frozen-lockfile', '--offline']);
}

function buildStage(stageRoot) {
  runPnpm(stageRoot, ['--filter', '@jesscss/core', 'build']);
  runPnpm(stageRoot, ['--filter', '@jesscss/css-parser', 'build']);
  runPnpm(stageRoot, ['--filter', '@jesscss/less-parser', 'build']);
}

function buildArtifact(stageRoot, commit, input) {
  restoreCommit(stageRoot, commit);
  buildStage(stageRoot);
  const parserBundle = path.join(stageRoot, 'packages/less-parser/lib/index.js');
  const coreBundle = path.join(stageRoot, 'packages/core/lib/index.js');
  const grammarSource = path.join(stageRoot, 'packages/less-parser/src/ast/grammar.ts');
  const artifact = path.join(stageRoot, '.benchmark-artifacts', `${commit}.mjs`);
  fs.copyFileSync(parserBundle, artifact);
  const metadata = {
    commit,
    parserBundle: digestFile(parserBundle),
    coreBundle: digestFile(coreBundle),
    grammarSource: digestFile(grammarSource),
    input: digestBuffer(input),
    artifact
  };
  return metadata;
}

function buildDeterministicArtifact(stageRoot, commit, input) {
  const first = buildArtifact(stageRoot, commit, input);
  const second = buildArtifact(stageRoot, commit, input);
  if (first.parserBundle.sha256 !== second.parserBundle.sha256 || first.parserBundle.bytes !== second.parserBundle.bytes) {
    throw new Error(`${commit} produced non-deterministic generated Less parser artifacts in one fixed stage path.`);
  }
  return {
    ...second,
    reproducible: {
      first: first.parserBundle,
      second: second.parserBundle
    }
  };
}

function assertSharedRuntime(before, after) {
  if (before.coreBundle.sha256 !== after.coreBundle.sha256 || before.coreBundle.bytes !== after.coreBundle.bytes) {
    throw new Error('Core bundle differs between commits; this direct parser comparison must not share a changed runtime.');
  }
}

function installLoadCopies(stageRoot, before, after) {
  const directory = path.join(stageRoot, 'packages/less-parser/.benchmark-artifacts');
  fs.mkdirSync(directory, { recursive: true });
  const copy = (artifact) => {
    const target = path.join(directory, `${artifact.commit}-${artifact.parserBundle.sha256}.mjs`);
    fs.copyFileSync(artifact.artifact, target);
    return target;
  };
  return { before: copy(before), after: copy(after) };
}

async function loadArtifact(metadata, parserBundle, coreBundle) {
  const unique = `?ab=${encodeURIComponent(metadata.parserBundle.sha256)}`;
  const parserModule = await import(`${pathToFileURL(parserBundle).href}${unique}`);
  const coreModule = await import(`${pathToFileURL(coreBundle).href}${unique}`);
  if (typeof parserModule.parse !== 'function') {
    throw new TypeError(`${metadata.commit} parser bundle does not export public parse().`);
  }
  if (typeof coreModule.serialize !== 'function') {
    throw new TypeError(`${metadata.commit} core bundle does not export AST serialize().`);
  }
  return { ...metadata, parse: parserModule.parse, serialize: coreModule.serialize };
}

function digestText(value) {
  return digestBuffer(Buffer.from(value));
}

function measure(artifact, input) {
  const parseStarted = performance.now();
  const document = artifact.parse(input);
  const parsedAt = performance.now();
  const serialized = artifact.serialize(document).css;
  const finishedAt = performance.now();
  return {
    parseMs: parsedAt - parseStarted,
    parseSerializeMs: finishedAt - parseStarted,
    document: digestText(JSON.stringify(document)),
    output: digestText(serialized)
  };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return {
    samples: values.length,
    medianMs: percentile(sorted, 0.5),
    meanMs: mean,
    minMs: sorted[0],
    p25Ms: percentile(sorted, 0.25),
    p75Ms: percentile(sorted, 0.75),
    maxMs: sorted.at(-1)
  };
}

function phaseSummary(pairs, phase) {
  const before = pairs.map(pair => pair.before[phase]);
  const after = pairs.map(pair => pair.after[phase]);
  const deltas = after.map((value, index) => value - before[index]);
  const beforeSummary = summarize(before);
  const afterSummary = summarize(after);
  return {
    before: beforeSummary,
    after: afterSummary,
    delta: summarize(deltas),
    medianPercent: beforeSummary.medianMs === 0 ? 0 : (afterSummary.medianMs - beforeSummary.medianMs) / beforeSummary.medianMs * 100,
    afterWins: pairs.filter(pair => pair.after[phase] < pair.before[phase]).length
  };
}

function sameDigest(left, right) {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

function sampleEquivalent(pairs) {
  return pairs.every(pair => sameDigest(pair.before.document, pair.after.document) && sameDigest(pair.before.output, pair.after.output));
}

function printableMetadata(metadata) {
  return {
    commit: metadata.commit,
    parserBundle: metadata.parserBundle,
    coreBundle: metadata.coreBundle,
    grammarSource: metadata.grammarSource,
    reproducible: metadata.reproducible
  };
}

let stageRoot;
try {
  const options = parseArgs(process.argv.slice(2));
  const beforeCommit = resolveCommit(options.before);
  const afterCommit = resolveCommit(options.after);
  const comparable = assertComparable(beforeCommit, afterCommit, options.fixture);
  stageRoot = canonicalStageRoot(options.stageRoot);
  prepareStage(stageRoot);
  restoreCommit(stageRoot, beforeCommit);
  installStage(stageRoot);
  const before = buildDeterministicArtifact(stageRoot, beforeCommit, comparable.input);
  const after = buildDeterministicArtifact(stageRoot, afterCommit, comparable.input);
  assertSharedRuntime(before, after);
  const loadCopies = installLoadCopies(stageRoot, before, after);
  const coreBundle = path.join(stageRoot, 'packages/core/lib/index.js');
  const loadedBefore = await loadArtifact(before, loadCopies.before, coreBundle);
  const loadedAfter = await loadArtifact(after, loadCopies.after, coreBundle);

  for (let index = 0; index < options.warmup; index++) {
    if (index % 2 === 0) {
      measure(loadedBefore, comparable.input);
      measure(loadedAfter, comparable.input);
    } else {
      measure(loadedAfter, comparable.input);
      measure(loadedBefore, comparable.input);
    }
  }

  const pairs = [];
  for (let index = 0; index < options.pairs; index++) {
    const afterFirst = index % 2 === 1;
    const first = afterFirst ? measure(loadedAfter, comparable.input) : measure(loadedBefore, comparable.input);
    const second = afterFirst ? measure(loadedBefore, comparable.input) : measure(loadedAfter, comparable.input);
    pairs.push({
      index: index + 1,
      order: afterFirst ? 'after-before' : 'before-after',
      before: afterFirst ? second : first,
      after: afterFirst ? first : second
    });
  }

  const result = {
    type: 'direct-less-ast-replayed-artifact-ab',
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fixture: { path: options.fixture, ...digestBuffer(comparable.input) },
    lock: comparable.lock,
    changedPaths: comparable.changed,
    warmup: options.warmup,
    pairs: options.pairs,
    before: printableMetadata(before),
    after: printableMetadata(after),
    byteIdentical: sampleEquivalent(pairs),
    parse: phaseSummary(pairs, 'parseMs'),
    parseSerialize: phaseSummary(pairs, 'parseSerializeMs'),
    rawInterleavedSamples: pairs
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`replayed direct AST artifact A/B fixture=${options.fixture}`);
    for (const phase of ['parse', 'parseSerialize']) {
      const summary = result[phase];
      console.log(`${phase}: before median=${summary.before.medianMs.toFixed(3)}ms after median=${summary.after.medianMs.toFixed(3)}ms delta=${summary.delta.medianMs.toFixed(3)}ms (${summary.medianPercent.toFixed(2)}%), afterWins=${summary.afterWins}/${options.pairs}`);
    }
    console.log(`AST/output byte-identical=${result.byteIdentical}`);
    console.log(`before parser=${before.parserBundle.sha256} after parser=${after.parserBundle.sha256}`);
  }
  if (!result.byteIdentical) {
    process.exitCode = 2;
  }
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
} finally {
  if (stageRoot && fs.existsSync(stageRoot)) {
    const marker = path.join(stageRoot, '.jess-stage-marker');
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === stageMarker) {
      fs.rmSync(stageRoot, { recursive: true, force: true });
    }
  }
}
