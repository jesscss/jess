#!/usr/bin/env node

/*
 * Diagnostic-only benchmark for the static `(multiple)` import placement path.
 * Build the workspace first, then run:
 * node scripts/measure-import-placement.mjs --warmup=8 --iterations=30 --rounds=3
 */

import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = readOptions(process.argv.slice(2));
const fixtureRoot = path.join(repoRoot, 'packages/jess/benchmark/import-placement');
const fixtureNames = [1, 2, 3].map(multiplier => ({
  multiplier,
  file: path.join(fixtureRoot, `${multiplier}x.less`)
}));

const [
  { Context, Rules, StyleImport, spineRenderCounter },
  { Compiler },
  { default: lessPlugin },
  { lessCompatPlugin }
] = await Promise.all([
  import(pathToFileURL(path.join(repoRoot, 'packages/core/lib/index.js')).href),
  import(pathToFileURL(path.join(repoRoot, 'packages/jess/lib/index.js')).href),
  import(pathToFileURL(path.join(repoRoot, 'packages/jess-plugin-less/lib/index.js')).href),
  import(pathToFileURL(path.join(repoRoot, 'packages/jess-plugin-less-compat/lib/index.js')).href)
]);

let activeMetrics;
const spineImportBodies = new WeakSet();

instrument(Context.prototype, 'getTree', function beforeGetTree() {
  return new Set(this.sourceTrees?.keys());
}, function afterGetTree(beforePaths, result, elapsedMs) {
  const sourceFixture = path.basename(result?.resolvedPath ?? '') === 'source.less';
  const hit = beforePaths.has(result?.resolvedPath);
  activeMetrics.sourceTree.calls++;
  activeMetrics.sourceTree.ms += elapsedMs;
  if (hit) {
    activeMetrics.sourceTree.hits++;
  } else {
    activeMetrics.sourceTree.misses++;
  }
  if (sourceFixture) {
    activeMetrics.sourceTree.importCalls++;
    activeMetrics.sourceTree.importMs += elapsedMs;
    if (hit) {
      activeMetrics.sourceTree.importHits++;
    } else {
      activeMetrics.sourceTree.importMisses++;
    }
  }
});
instrument(StyleImport.prototype, 'createFirstUseImportPlacementState', undefined, function afterPlacementState(_before, _result, elapsedMs) {
  activeMetrics.placement.stateCalls++;
  activeMetrics.placement.stateMs += elapsedMs;
});
instrument(StyleImport.prototype, 'materializeImportPlacementState', undefined, function afterPlacementSurface(_before, _result, elapsedMs) {
  activeMetrics.placement.surfaceCalls++;
  activeMetrics.placement.surfaceMs += elapsedMs;
});
instrument(StyleImport.prototype, 'resolveForSpine', undefined, function afterSpineResolution(_before, result, elapsedMs) {
  activeMetrics.spine.resolveCalls++;
  activeMetrics.spine.resolveMs += elapsedMs;
  if (result?.kind === 'fold') {
    spineImportBodies.add(result.body);
  }
});
instrument(StyleImport.prototype, 'evalNode', undefined, function afterImportEval(_before, _result, elapsedMs) {
  activeMetrics.spine.importEvalCalls++;
  activeMetrics.spine.importEvalMs += elapsedMs;
});
instrument(Rules.prototype, 'prepareRegistration', undefined, function afterRegistration(_before, _result, elapsedMs) {
  activeMetrics.registration.calls++;
  activeMetrics.registration.ms += elapsedMs;
  if (spineImportBodies.has(this)) {
    activeMetrics.registration.importPlacementCalls++;
    activeMetrics.registration.importPlacementMs += elapsedMs;
  }
});
instrument(Rules.prototype, 'derive', undefined, function afterDerive(_before, _result, elapsedMs) {
  activeMetrics.spine.deriveCalls++;
  activeMetrics.spine.deriveMs += elapsedMs;
});

const compiler = createCompiler();
activeMetrics = emptyMetrics();
const sourceCss = await compiler.render(path.join(fixtureRoot, 'source.less'));
const results = [];
for (const fixture of fixtureNames) {
  const expectedCss = sourceCss.repeat(fixture.multiplier);
  results.push(await measureFixture(compiler, fixture, expectedCss));
}

console.log(JSON.stringify({
  fixtureRoot,
  options,
  source: {
    bytes: Buffer.byteLength(sourceCss),
    sha256: hash(sourceCss)
  },
  results
}, null, 2));

function createCompiler() {
  return new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
  });
}

async function measureFixture(compiler, fixture, expectedCss) {
  for (let i = 0; i < options.warmup; i++) {
    activeMetrics = emptyMetrics();
    await renderChecked(compiler, fixture.file, expectedCss);
  }

  const samples = [];
  const metrics = emptyMetrics();
  for (let round = 0; round < options.rounds; round++) {
    for (let i = 0; i < options.iterations; i++) {
      activeMetrics = emptyMetrics();
      const beforeSpineRenders = spineRenderCounter.rootRenders;
      const startMs = performance.now();
      const css = await compiler.render(fixture.file);
      const elapsedMs = performance.now() - startMs;
      assertByteIdentity(fixture.file, css, expectedCss);
      activeMetrics.spine.rootRenders = spineRenderCounter.rootRenders - beforeSpineRenders;
      samples.push(elapsedMs);
      addMetrics(metrics, activeMetrics);
    }
  }

  return {
    fixture: path.relative(repoRoot, fixture.file),
    multiplier: fixture.multiplier,
    output: {
      byteIdentical: true,
      bytes: Buffer.byteLength(expectedCss),
      sha256: hash(expectedCss)
    },
    timing: summarize(samples),
    perRender: divideMetrics(metrics, samples.length)
  };
}

async function renderChecked(compiler, file, expectedCss) {
  const css = await compiler.render(file);
  assertByteIdentity(file, css, expectedCss);
}

function assertByteIdentity(file, css, expectedCss) {
  if (css !== expectedCss) {
    throw new Error(`Output mismatch for ${path.relative(repoRoot, file)}: expected ${hash(expectedCss)}, received ${hash(css)}`);
  }
}

function instrument(proto, name, before, after) {
  const original = proto[name];
  if (typeof original !== 'function') {
    throw new TypeError(`Expected ${proto.constructor.name}.${name} to be a function`);
  }
  proto[name] = function instrumented(...args) {
    const state = before?.call(this, args);
    const startMs = performance.now();
    const finish = (result) => {
      after?.call(this, state, result, performance.now() - startMs);
      return result;
    };
    const result = original.apply(this, args);
    return result && typeof result.then === 'function' ? result.then(finish) : finish(result);
  };
}

function emptyMetrics() {
  return {
    sourceTree: {
      calls: 0,
      hits: 0,
      misses: 0,
      ms: 0,
      importCalls: 0,
      importHits: 0,
      importMisses: 0,
      importMs: 0
    },
    placement: { stateCalls: 0, stateMs: 0, surfaceCalls: 0, surfaceMs: 0 },
    registration: { calls: 0, ms: 0, importPlacementCalls: 0, importPlacementMs: 0 },
    spine: {
      resolveCalls: 0,
      resolveMs: 0,
      importEvalCalls: 0,
      importEvalMs: 0,
      deriveCalls: 0,
      deriveMs: 0,
      rootRenders: 0
    }
  };
}

function addMetrics(total, sample) {
  for (const section of Object.keys(total)) {
    for (const key of Object.keys(total[section])) {
      total[section][key] += sample[section][key];
    }
  }
}

function divideMetrics(total, count) {
  const average = {};
  for (const [section, values] of Object.entries(total)) {
    average[section] = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round(value / count)]));
  }
  return average;
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    minMs: round(sorted[0]),
    medianMs: round(percentile(sorted, 0.5)),
    p90Ms: round(percentile(sorted, 0.9)),
    maxMs: round(sorted.at(-1)),
    relativeStdDev: round(relativeStdDev(sorted))
  };
}

function percentile(sorted, quantile) {
  const index = (sorted.length - 1) * quantile;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function relativeStdDev(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return mean === 0 ? 0 : Math.sqrt(variance) / mean;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function round(value) {
  return Number(value.toFixed(4));
}

function readOptions(args) {
  const options = { warmup: 8, iterations: 30, rounds: 3 };
  for (const arg of args) {
    const match = /^--(warmup|iterations|rounds)=(\d+)$/.exec(arg);
    if (!match) {
      throw new Error(`Expected --warmup=N, --iterations=N, or --rounds=N; received ${arg}`);
    }
    options[match[1]] = Number(match[2]);
  }
  if (Object.values(options).some(value => value < 1)) {
    throw new Error('warmup, iterations, and rounds must be positive');
  }
  return options;
}
