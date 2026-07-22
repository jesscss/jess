#!/usr/bin/env node

/**
 * Compare two built direct-Less AST parser artifacts.
 *
 * This intentionally does not construct Context, load plugins, call getTree(),
 * or invoke a legacy tree render method. Each side imports exactly the built
 * public parser and AST serializer from the supplied checkout, then records
 * parse-only and parse-plus-direct-serialize timings on interleaved samples.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function usage(message) {
  if (message) {
    console.error(`Error: ${message}`);
  }
  console.error('Usage: node scripts/compare-less-ast-builds.mjs --before-root <checkout> --after-root <checkout> --fixture <less-file> [--warmup N] [--pairs N] [--json]');
  process.exitCode = 1;
}

function readPositiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`${flag} must be a non-negative integer`);
  }
  return number;
}

function parseArgs(argv) {
  const options = { warmup: 20, pairs: 45, json: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--json') {
      options.json = true;
      continue;
    }
    if (!['--before-root', '--after-root', '--fixture', '--warmup', '--pairs'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    if (flag === '--warmup') {
      options.warmup = readPositiveInteger(value, flag);
    } else if (flag === '--pairs') {
      options.pairs = readPositiveInteger(value, flag);
    } else {
      const key = flag === '--before-root'
        ? 'beforeRoot'
        : flag === '--after-root'
          ? 'afterRoot'
          : 'fixture';
      options[key] = value;
    }
  }
  if (!options.beforeRoot || !options.afterRoot || !options.fixture) {
    throw new Error('--before-root, --after-root, and --fixture are required');
  }
  if (options.pairs < 1) {
    throw new Error('--pairs must be at least one');
  }
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileDigest(file) {
  const bytes = fs.readFileSync(file);
  return { path: file, bytes: bytes.length, sha256: sha256(bytes), mtimeMs: fs.statSync(file).mtimeMs };
}

function gitCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function resolveArtifact(root, label) {
  const resolvedRoot = fs.realpathSync(root);
  const parserBundle = path.join(resolvedRoot, 'packages/less-parser/lib/index.js');
  const coreBundle = path.join(resolvedRoot, 'packages/core/lib/index.js');
  const grammarSource = path.join(resolvedRoot, 'packages/less-parser/src/ast/grammar.ts');
  for (const file of [parserBundle, coreBundle, grammarSource]) {
    if (!fs.existsSync(file)) {
      throw new Error(`${label} build is missing ${file}; build that checkout before measuring.`);
    }
  }
  const parser = fileDigest(parserBundle);
  const core = fileDigest(coreBundle);
  const source = fileDigest(grammarSource);
  if (parser.mtimeMs < source.mtimeMs) {
    throw new Error(`${label} parser bundle predates its grammar source (${parserBundle}); rebuild before measuring.`);
  }
  return {
    label,
    root: resolvedRoot,
    commit: gitCommit(resolvedRoot),
    parserBundle: parser,
    coreBundle: core,
    grammarSource: source
  };
}

async function loadArtifact(meta) {
  const unique = `?ab=${encodeURIComponent(`${meta.parserBundle.sha256}-${meta.coreBundle.sha256}`)}`;
  const parserModule = await import(`${pathToFileURL(meta.parserBundle.path).href}${unique}`);
  const coreModule = await import(`${pathToFileURL(meta.coreBundle.path).href}${unique}`);
  if (typeof parserModule.parse !== 'function') {
    throw new TypeError(`${meta.label} parser bundle does not export public parse().`);
  }
  if (typeof coreModule.serialize !== 'function') {
    throw new TypeError(`${meta.label} core bundle does not export AST serialize().`);
  }
  return { ...meta, parse: parserModule.parse, serialize: coreModule.serialize };
}

function digestText(text) {
  return { bytes: Buffer.byteLength(text), sha256: sha256(text) };
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
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return { samples: values.length, medianMs: percentile(sorted, 0.5), meanMs: mean, minMs: sorted[0], p25Ms: percentile(sorted, 0.25), p75Ms: percentile(sorted, 0.75), maxMs: sorted.at(-1) };
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

try {
  const options = parseArgs(process.argv.slice(2));
  const fixture = path.resolve(options.fixture);
  if (!fs.existsSync(fixture)) {
    throw new Error(`Fixture does not exist: ${fixture}`);
  }
  const input = fs.readFileSync(fixture, 'utf8');
  const before = await loadArtifact(resolveArtifact(options.beforeRoot, 'before'));
  const after = await loadArtifact(resolveArtifact(options.afterRoot, 'after'));

  for (let index = 0; index < options.warmup; index++) {
    if (index % 2 === 0) {
      measure(before, input);
      measure(after, input);
    } else {
      measure(after, input);
      measure(before, input);
    }
  }

  const pairs = [];
  for (let index = 0; index < options.pairs; index++) {
    const afterFirst = index % 2 === 1;
    const first = afterFirst ? measure(after, input) : measure(before, input);
    const second = afterFirst ? measure(before, input) : measure(after, input);
    pairs.push({
      index: index + 1,
      order: afterFirst ? 'after-before' : 'before-after',
      before: afterFirst ? second : first,
      after: afterFirst ? first : second
    });
  }

  const result = {
    type: 'direct-less-ast-built-artifact-ab',
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fixture: { ...fileDigest(fixture), sourceSha256: sha256(input) },
    warmup: options.warmup,
    pairs: options.pairs,
    before: {
      root: before.root, commit: before.commit, parserBundle: before.parserBundle,
      coreBundle: before.coreBundle, grammarSource: before.grammarSource
    },
    after: {
      root: after.root, commit: after.commit, parserBundle: after.parserBundle,
      coreBundle: after.coreBundle, grammarSource: after.grammarSource
    },
    byteIdentical: sampleEquivalent(pairs),
    parse: phaseSummary(pairs, 'parseMs'),
    parseSerialize: phaseSummary(pairs, 'parseSerializeMs'),
    rawInterleavedSamples: pairs
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`direct AST built-artifact A/B fixture=${fixture}`);
    for (const phase of ['parse', 'parseSerialize']) {
      const summary = result[phase];
      console.log(`${phase}: before median=${summary.before.medianMs.toFixed(3)}ms after median=${summary.after.medianMs.toFixed(3)}ms delta=${summary.delta.medianMs.toFixed(3)}ms (${summary.medianPercent.toFixed(2)}%), afterWins=${summary.afterWins}/${options.pairs}`);
    }
    console.log(`AST/output byte-identical=${result.byteIdentical}`);
    console.log(`before parser=${before.parserBundle.sha256} grammar=${before.grammarSource.sha256}`);
    console.log(`after parser=${after.parserBundle.sha256} grammar=${after.grammarSource.sha256}`);
  }
  if (!result.byteIdentical) {
    process.exitCode = 2;
  }
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}
