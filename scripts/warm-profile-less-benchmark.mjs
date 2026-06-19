#!/usr/bin/env node

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import inspector from 'node:inspector';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const args = new Map(
  process.argv.slice(2).filter(arg => arg !== '--').map((arg) => {
    const [key, value = 'true'] = arg.split('=');
    return [key, value];
  })
);

const lessRepoRoot = path.resolve(args.get('--less-repo-root') ?? path.join(repoRoot, '../less.js'));
const lessPkgRoot = path.join(lessRepoRoot, 'packages/less');
const benchmarkRoot = path.resolve(args.get('--benchmark-root') ?? path.join(lessPkgRoot, 'benchmark'));
const benchmarkArg = args.get('--file') ?? args.get('--fixture') ?? 'benchmark.less';
const benchmarkFile = path.isAbsolute(benchmarkArg)
  ? benchmarkArg
  : path.join(benchmarkRoot, benchmarkArg);
const warmup = Number(args.get('--warmup') ?? 8);
const runs = Number(args.get('--runs') ?? 3);
const math = args.get('--math') ?? 'parens-division';
const outputRoot = path.resolve(args.get('--out') ?? path.join(repoRoot, 'profiling/core-architecture'));
const label = args.get('--label') ?? 'warm-benchmark-less';
const skipPluginFreeCompat = args.get('--skip-plugin-free-compat') !== 'false';
const runGc = args.get('--gc') !== 'false';
const topLimit = Number(args.get('--top') ?? 30);

const requiredBuiltFiles = [
  'packages/core/lib/index.js',
  'packages/less-parser/lib/index.js',
  'packages/jess-plugin-less/lib/index.js',
  'packages/jess-plugin-less-compat/lib/index.js',
  'packages/jess/lib/index.js'
].map(file => path.join(repoRoot, file));

const lessFacadeLib = path.join(lessPkgRoot, 'lib/index.js');

function failPrereq(message) {
  throw new Error(`${message}\nPrerequisite build:\n  pnpm --filter @jesscss/core build\n  pnpm --filter @jesscss/less-parser build\n  pnpm --filter @jesscss/plugin-less build\n  pnpm --filter @jesscss/plugin-less-compat build\n  pnpm --filter jess build\nOr run the full workspace build with:\n  pnpm run build`);
}

for (const file of [...requiredBuiltFiles, lessFacadeLib, benchmarkFile]) {
  if (!fs.existsSync(file)) {
    failPrereq(`Required file is missing: ${file}`);
  }
}

function renderWith(less, source, options) {
  return new Promise((resolve, reject) => {
    less.render(source, options, (error, output) => {
      if (error) {
        reject(error);
        return;
      }
      if (!output || typeof output.css !== 'string') {
        reject(new Error('less.render completed without CSS output'));
        return;
      }
      resolve(output);
    });
  });
}

function percentile(sorted, pct) {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const avg = total / sorted.length;
  const trimCount = Math.floor(sorted.length * 0.1);
  const trimmed = trimCount > 0 && sorted.length > trimCount * 2
    ? sorted.slice(trimCount, sorted.length - trimCount)
    : sorted;
  const trimmedAvg = trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const variance = sorted.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / sorted.length;
  const stddev = Math.sqrt(variance);
  return {
    samples: sorted.length,
    min: Number(sorted[0].toFixed(2)),
    p25: Number(percentile(sorted, 0.25).toFixed(2)),
    median: Number(median.toFixed(2)),
    p75: Number(percentile(sorted, 0.75).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number(avg.toFixed(2)),
    trimmedAvg: Number(trimmedAvg.toFixed(2)),
    stddev: Number(stddev.toFixed(2)),
    variancePct: Number(((stddev / avg) * 100).toFixed(2))
  };
}

function post(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function profileTimeDeltas(profile) {
  if (Array.isArray(profile.timeDeltas) && profile.timeDeltas.length === profile.samples?.length) {
    return profile.timeDeltas;
  }
  return Array(profile.samples?.length ?? 0).fill(1000);
}

function normalizeFileUrl(url) {
  if (!url.startsWith('file://')) {
    return null;
  }
  return fileURLToPath(url);
}

function isRepoPackageFrame(row) {
  const filePath = normalizeFileUrl(row.url);
  if (!filePath) {
    return false;
  }
  return filePath.startsWith(path.join(repoRoot, 'packages'))
    || filePath.startsWith(path.join(lessPkgRoot, 'lib'));
}

function isRepoRuntimeFrame(row) {
  const filePath = normalizeFileUrl(row.url);
  if (!filePath) {
    return false;
  }
  return filePath.startsWith(repoRoot) || filePath.startsWith(lessRepoRoot);
}

function summarizeProfile(profile, limit) {
  const nodesById = new Map(profile.nodes.map(node => [node.id, node]));
  const byNode = new Map();
  const deltas = profileTimeDeltas(profile);

  for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
    const nodeId = profile.samples[index];
    const micros = deltas[index] ?? 0;
    const previous = byNode.get(nodeId) ?? 0;
    byNode.set(nodeId, previous + micros);
  }

  const rows = [...byNode.entries()]
    .map(([nodeId, micros]) => {
      const node = nodesById.get(nodeId);
      const callFrame = node?.callFrame ?? {};
      return {
        functionName: callFrame.functionName || '(anonymous)',
        url: callFrame.url || '',
        lineNumber: typeof callFrame.lineNumber === 'number' ? callFrame.lineNumber + 1 : null,
        selfMs: Number((micros / 1000).toFixed(2)),
        hitCount: node?.hitCount ?? 0
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs);

  const byFunction = new Map();
  for (const row of rows) {
    const key = `${row.functionName} ${row.url}`;
    const current = byFunction.get(key) ?? {
      functionName: row.functionName,
      url: row.url,
      selfMs: 0,
      hitCount: 0
    };
    current.selfMs += row.selfMs;
    current.hitCount += row.hitCount;
    byFunction.set(key, current);
  }

  const topSelfFunctions = [...byFunction.values()]
    .map(row => ({
      ...row,
      selfMs: Number(row.selfMs.toFixed(2))
    }))
    .sort((a, b) => b.selfMs - a.selfMs);

  return {
    sampleCount: profile.samples?.length ?? 0,
    durationMs: Number((((profile.endTime ?? 0) - (profile.startTime ?? 0)) / 1000).toFixed(2)),
    topSelfNodes: rows.slice(0, limit),
    topSelfFunctions: topSelfFunctions.slice(0, limit),
    topRepoPackageFunctions: topSelfFunctions.filter(isRepoPackageFrame).slice(0, limit),
    topRepoRuntimeFunctions: topSelfFunctions.filter(isRepoRuntimeFrame).slice(0, limit)
  };
}

function timestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function timedRender(less, source, options) {
  const start = performance.now();
  await renderWith(less, source, options);
  return performance.now() - start;
}

const source = fs.readFileSync(benchmarkFile, 'utf8');
const lessModule = await import(pathToFileURL(lessFacadeLib).href);
const less = lessModule.default ?? lessModule;
if (!less?.render) {
  throw new Error(`Less facade at ${lessFacadeLib} does not expose render()`);
}

const renderOptions = {
  filename: benchmarkFile,
  paths: [path.dirname(benchmarkFile)],
  math,
  __jessSkipLessCompatWhenPluginFree: skipPluginFreeCompat
};

const warmupSamples = [];
for (let index = 0; index < warmup; index++) {
  warmupSamples.push(await timedRender(less, source, renderOptions));
}

if (runGc && typeof globalThis.gc === 'function') {
  globalThis.gc();
}

const session = new inspector.Session();
session.connect();
let profile;
const profiledSamples = [];
try {
  await post(session, 'Profiler.enable');
  await post(session, 'Profiler.start');
  for (let index = 0; index < runs; index++) {
    profiledSamples.push(await timedRender(less, source, renderOptions));
  }
  ({ profile } = await post(session, 'Profiler.stop'));
} finally {
  session.disconnect();
}

const outputDir = path.join(outputRoot, `${timestamp()}-${label}`);
await fsp.mkdir(outputDir, { recursive: true });
const profileFile = path.join(outputDir, 'warm-benchmark.less.cpuprofile');
const summaryFile = path.join(outputDir, 'summary.json');
await fsp.writeFile(profileFile, JSON.stringify(profile));

const summary = {
  type: 'warm-less-benchmark-cpu-profile',
  timestamp: new Date().toISOString(),
  repoRoot,
  lessRepoRoot,
  benchmarkFile,
  profileFile,
  summaryFile,
  prerequisites: {
    builtPackages: requiredBuiltFiles,
    lessFacadeLib
  },
  options: {
    warmup,
    runs,
    math,
    skipPluginFreeCompat,
    gcRequested: runGc,
    gcAvailable: typeof globalThis.gc === 'function'
  },
  timings: {
    warmupMs: warmupSamples.map(value => Number(value.toFixed(2))),
    profiledMs: profiledSamples.map(value => Number(value.toFixed(2))),
    warmupSummary: summarize(warmupSamples),
    profiledSummary: summarize(profiledSamples)
  },
  profileSummary: summarizeProfile(profile, topLimit)
};

await fsp.writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
