#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.split('=');
    return [key, value];
  })
);

const lessRepoRoot = path.resolve(repoRoot, '../less.js');
const lessPkgRoot = path.join(lessRepoRoot, 'packages/less');
const benchmarkArg = args.get('--file') ?? 'benchmark.less';
const benchmarkRoot = path.join(lessPkgRoot, 'benchmark');
const benchmarkFile = path.isAbsolute(benchmarkArg)
  ? benchmarkArg
  : path.join(benchmarkRoot, benchmarkArg);
const limit = Number(args.get('--limit') ?? 30);

const coreLib = pathToFileURL(path.join(repoRoot, 'packages/core/lib/index.js')).href;
const lessFacadeLib = pathToFileURL(path.join(lessPkgRoot, 'lib/index.js')).href;

const [{ Node }, lessModule] = await Promise.all([
  import(coreLib),
  import(lessFacadeLib)
]);
const less = lessModule.default ?? lessModule;

const { isArray } = Array;
const objectPrototype = Object.prototype;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === objectPrototype || prototype === null;
}

function classifyValue(value) {
  if (value instanceof Node) {
    return 'node';
  }
  if (isArray(value)) {
    return 'array';
  }
  if (isPlainObject(value)) {
    return 'plainObject';
  }
  return 'other';
}

function getStats(map, name) {
  let stats = map.get(name);
  if (!stats) {
    stats = {
      total: 0,
      node: 0,
      array: 0,
      plainObject: 0,
      other: 0
    };
    map.set(name, stats);
  }
  return stats;
}

const originalProcessNodes = Node.prototype._processNodes;
if (typeof originalProcessNodes !== 'function') {
  throw new TypeError('Node.prototype._processNodes is not available in built core output');
}

const counts = new Map();
Node.prototype._processNodes = function(value) {
  const name = this?.constructor?.name || '(unknown)';
  const stats = getStats(counts, name);
  stats.total++;
  stats[classifyValue(value)]++;
  return originalProcessNodes.call(this, value);
};

try {
  const source = fs.readFileSync(benchmarkFile, 'utf8');
  await less.render(source, {
    filename: benchmarkFile,
    paths: [path.dirname(benchmarkFile)],
    math: args.get('--math') ?? 'parens-division',
    __jessSkipLessCompatWhenPluginFree: args.get('--skip-plugin-free-compat') !== 'false'
  });
} finally {
  Node.prototype._processNodes = originalProcessNodes;
}

const rows = [...counts.entries()]
  .sort((a, b) => b[1].total - a[1].total)
  .slice(0, limit)
  .map(([name, stats]) => ({ name, ...stats }));

console.log(JSON.stringify({
  type: 'constructor-child-processing-profile',
  benchmarkFile,
  rows
}, null, 2));
