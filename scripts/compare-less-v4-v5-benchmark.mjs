#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const repoRequire = createRequire(path.join(repoRoot, 'package.json'));

const args = new Map(
  process.argv.slice(2).filter(arg => arg !== '--').map((arg) => {
    const [key, value = 'true'] = arg.split('=');
    return [key, value];
  })
);

const lessV5Root = path.resolve(args.get('--less-v5-root') ?? path.join(repoRoot, '../less.js/packages/less'));
const benchmarkRoot = path.resolve(args.get('--benchmark-root') ?? path.join(lessV5Root, 'benchmark'));
const files = (args.get('--files') ?? 'benchmark.less')
  .split(',')
  .map(file => file.trim())
  .filter(Boolean);
const runs = Number(args.get('--runs') ?? 80);
const warmup = Number(args.get('--warmup') ?? 20);
const math = args.get('--math') ?? 'parens-division';
const skipPluginFreeCompat = args.get('--skip-plugin-free-compat') !== 'false';
const less4Mode = args.get('--less4') ?? 'historical';
const historicalFile = path.join(lessV5Root, 'benchmark/results/latest/macbook-pro_arm64.json');

function resolveImportCandidate(importPath, fromDir) {
  const base = path.isAbsolute(importPath) ? importPath : path.resolve(fromDir, importPath);
  const candidates = [base, `${base}.less`];
  const parsed = path.parse(base);
  if (!parsed.base.startsWith('_')) {
    candidates.push(path.join(parsed.dir, `_${parsed.base}`));
    candidates.push(path.join(parsed.dir, `_${parsed.base}.less`));
  }
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

function literalImports(source, fromDir) {
  const imports = [];
  const re = /@import\s+(?:\([^)]*\)\s*)?(?:"([^"]+)"|'([^']+)')\s*;/g;
  let match;
  while ((match = re.exec(source))) {
    const importPath = match[1] ?? match[2];
    if (!importPath || /^[a-z]+:/i.test(importPath) || importPath.endsWith('.css')) {
      return null;
    }
    const resolved = resolveImportCandidate(importPath, fromDir);
    if (!resolved) {
      return null;
    }
    imports.push(resolved);
  }
  return imports;
}

function sourceGraphIsPluginFree(entryFile) {
  const pending = [entryFile];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    let source;
    try {
      source = fs.readFileSync(current, 'utf8');
    } catch {
      return false;
    }
    if (source.includes('@plugin')) {
      return false;
    }
    const imports = literalImports(source, path.dirname(current));
    if (!imports) {
      return false;
    }
    pending.push(...imports);
  }
  return true;
}

function renderWith(less, source, options) {
  return new Promise((resolve, reject) => {
    less.render(source, options, (err, output) => {
      if (err) {
        reject(err);
        return;
      }
      if (!output || typeof output.css !== 'string') {
        reject(new Error('render completed without CSS output'));
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
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * pct)));
  return sorted[idx];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const avg = total / sorted.length;
  const trimCount = Math.floor(sorted.length * 0.1);
  const trimmed = trimCount > 0 && sorted.length > (trimCount * 2)
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
    p05: Number(percentile(sorted, 0.05).toFixed(2)),
    p25: Number(percentile(sorted, 0.25).toFixed(2)),
    median: Number(median.toFixed(2)),
    p75: Number(percentile(sorted, 0.75).toFixed(2)),
    p95: Number(percentile(sorted, 0.95).toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number(avg.toFixed(2)),
    trimmedAvg: Number(trimmedAvg.toFixed(2)),
    trimmedSamples: trimmed.length,
    stddev: Number(stddev.toFixed(2)),
    variancePct: Number(((stddev / avg) * 100).toFixed(2))
  };
}

async function measure(label, less, source, options) {
  const samples = [];
  for (let index = 0; index < warmup + runs; index++) {
    const start = performance.now();
    await renderWith(less, source, options);
    const elapsed = performance.now() - start;
    if (index >= warmup) {
      samples.push(elapsed);
    }
  }
  return {
    label,
    ...summarize(samples)
  };
}

function loadHistoricalLess4(file) {
  if (!fs.existsSync(historicalFile)) {
    throw new Error(`Historical Less 4 baseline file does not exist: ${historicalFile}`);
  }
  const historical = JSON.parse(fs.readFileSync(historicalFile, 'utf8'));
  const less4Entry = historical.versions?.find(version => version.version?.startsWith('4.5'))
    ?? historical.versions?.filter(version => version.version?.startsWith('4.')).pop();
  const benchmark = less4Entry?.benchmarks?.[path.basename(file)];
  if (!benchmark?.render) {
    throw new Error(`Historical Less 4 baseline missing for ${path.basename(file)} in ${historicalFile}`);
  }
  return {
    label: 'less4-historical',
    version: benchmark.version ?? less4Entry.version,
    source: historicalFile,
    samples: benchmark.render.samples ?? null,
    min: benchmark.render.min,
    median: benchmark.render.median,
    max: benchmark.render.max,
    avg: benchmark.render.avg,
    stddev: benchmark.render.stddev,
    variancePct: benchmark.render.variance_pct,
    node: less4Entry.node_version ?? null
  };
}

const lessV5Path = path.join(lessV5Root, 'lib/index.js');
const lessV5Module = await import(pathToFileURL(lessV5Path).href);
const lessV5 = lessV5Module.default ?? lessV5Module;

if (!lessV5?.render) {
  throw new Error(`Less v5 candidate at ${lessV5Path} does not expose render()`);
}

let less4;
let less4Path;
if (less4Mode === 'measure') {
  less4 = repoRequire('less');
  less4Path = repoRequire.resolve('less');
  if (!less4?.render) {
    throw new Error(`Less 4 candidate at ${less4Path} does not expose render()`);
  }
} else if (less4Mode !== 'historical') {
  throw new Error(`Unknown --less4 mode "${less4Mode}". Use "historical" or "measure".`);
}

const outputs = [];
for (const file of files) {
  const benchmarkFile = path.isAbsolute(file) ? file : path.join(benchmarkRoot, file);
  const source = fs.readFileSync(benchmarkFile, 'utf8');
  const pluginFree = sourceGraphIsPluginFree(benchmarkFile);
  const baseOptions = {
    filename: benchmarkFile,
    paths: [path.dirname(benchmarkFile)],
    math
  };
  const v5Options = {
    ...baseOptions
  };
  if (skipPluginFreeCompat && pluginFree) {
    v5Options.__jessSkipLessCompatWhenPluginFree = true;
  }

  const less4Result = less4Mode === 'measure'
    ? await measure('less4-measured', less4, source, baseOptions)
    : loadHistoricalLess4(benchmarkFile);
  const lessV5Result = await measure('less-v5-jess', lessV5, source, v5Options);
  outputs.push({
    file: benchmarkFile,
    fileSize: source.length,
    sourceGraphIsPluginFree: pluginFree,
    runs,
    warmup,
    math,
    identities: {
      less4: {
        mode: less4Mode,
        version: less4Mode === 'measure'
          ? (Array.isArray(less4.version) ? less4.version.join('.') : String(less4.version ?? 'unknown'))
          : less4Result.version,
        resolved: less4Mode === 'measure' ? less4Path : historicalFile
      },
      lessV5Jess: {
        version: Array.isArray(lessV5.version) ? lessV5.version.join('.') : String(lessV5.version ?? 'unknown'),
        resolved: lessV5Path
      }
    },
    results: {
      less4: less4Result,
      lessV5Jess: lessV5Result,
      medianRatio: Number(((lessV5Result.median / less4Result.median) - 1).toFixed(4)),
      trimmedAvgRatio: less4Result.trimmedAvg
        ? Number(((lessV5Result.trimmedAvg / less4Result.trimmedAvg) - 1).toFixed(4))
        : null,
      avgRatio: Number(((lessV5Result.avg / less4Result.avg) - 1).toFixed(4))
    }
  });
}

console.log(JSON.stringify({
  type: 'less-v4-vs-v5-jess-benchmark',
  timestamp: new Date().toISOString(),
  repoRoot,
  lessV5Root,
  outputs
}, null, 2));
