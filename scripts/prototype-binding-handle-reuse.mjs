#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

const DEFAULTS = {
  references: 500_000,
  warmup: 5,
  repeat: 20
};

const options = parseArgs(process.argv.slice(2));

console.log('Binding handle reuse prototype');
console.log(`node=${process.version} platform=${process.platform}/${process.arch}`);
console.log(`references=${options.references} warmup=${options.warmup} repeat=${options.repeat}`);

const fixture = buildFixture();
assertSemantics(fixture);

for (let i = 0; i < options.warmup; i++) {
  runBaseline(fixture, options.references);
  runHandleReuse(fixture, options.references);
}

const baselineTimes = [];
const handleTimes = [];
let baselineCounters;
let handleCounters;
let checksum = 0;
for (let i = 0; i < options.repeat; i++) {
  const baseline = runBaseline(fixture, options.references);
  const handle = runHandleReuse(fixture, options.references);
  if (baseline.checksum !== handle.checksum) {
    throw new Error(`Checksum mismatch: baseline=${baseline.checksum} handle=${handle.checksum}`);
  }
  checksum ^= baseline.checksum;
  baselineTimes.push(baseline.ms);
  handleTimes.push(handle.ms);
  baselineCounters = baseline.counters;
  handleCounters = handle.counters;
}

const baseline = summarize(baselineTimes);
const handle = summarize(handleTimes);
const rediscoveryRatio = handle.median / baseline.median;

assertEqual(handleCounters.pathSegmentLookups, 3, 'handle path segment lookups');
assertEqual(handleCounters.declarationLookups, 1, 'handle declaration lookups');
assertEqual(baselineCounters.pathSegmentLookups, options.references * 3, 'baseline path segment lookups');
assertEqual(baselineCounters.declarationLookups, options.references, 'baseline declaration lookups');

console.log(`semantic assertions=passed`);
console.log(`baseline rediscovery median=${baseline.median.toFixed(3)}ms mean=${baseline.mean.toFixed(3)}ms p25=${baseline.p25.toFixed(3)}ms p75=${baseline.p75.toFixed(3)}ms`);
console.log(`handle reuse median=${handle.median.toFixed(3)}ms mean=${handle.mean.toFixed(3)}ms p25=${handle.p25.toFixed(3)}ms p75=${handle.p75.toFixed(3)}ms`);
console.log(`median ratio=${(rediscoveryRatio * 100).toFixed(2)}% checksum=${checksum}`);
console.log(`baseline counters path=${baselineCounters.pathSegmentLookups} declaration=${baselineCounters.declarationLookups} valueReads=${baselineCounters.valueReads}`);
console.log(`handle counters path=${handleCounters.pathSegmentLookups} declaration=${handleCounters.declarationLookups} valueReads=${handleCounters.valueReads}`);

function buildFixture() {
  const root = createScope(undefined, 'root');
  const a = addChildScope(root, '.a');
  const b = addChildScope(a, '.b');
  const c = addChildScope(b, '.c');
  const colorCell = addDeclaration(c, 'color-1', 0x13572468);
  addDeclaration(c, 'color-2', 0x24681357);
  addChildScope(b, '.sibling');
  return {
    root,
    path: ['.a', '.b', '.c'],
    declaration: 'color-1',
    colorCell
  };
}

function assertSemantics(fixture) {
  const baseline = resolveCompoundReference(fixture.root, fixture.path, fixture.declaration, createCounters());
  const handle = createBindingHandle(fixture.root, fixture.path, fixture.declaration, createCounters());
  assertEqual(baseline.value, fixture.colorCell.value, 'baseline value');
  assertEqual(readBindingHandle(handle, createCounters()), fixture.colorCell.value, 'handle value');
  fixture.colorCell.value = 0xfeed1234;
  assertEqual(resolveCompoundReference(fixture.root, fixture.path, fixture.declaration, createCounters()).value, 0xfeed1234, 'baseline live cell');
  assertEqual(readBindingHandle(handle, createCounters()), 0xfeed1234, 'handle live cell');
  fixture.colorCell.value = 0x13572468;
}

function runBaseline(fixture, references) {
  const counters = createCounters();
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < references; i++) {
    const resolved = resolveCompoundReference(fixture.root, fixture.path, fixture.declaration, counters);
    checksum = ((checksum << 5) - checksum + resolved.value + (i & 7)) | 0;
  }
  return {
    checksum,
    counters,
    ms: performance.now() - start
  };
}

function runHandleReuse(fixture, references) {
  const counters = createCounters();
  const handle = createBindingHandle(fixture.root, fixture.path, fixture.declaration, counters);
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < references; i++) {
    const value = readBindingHandle(handle, counters);
    checksum = ((checksum << 5) - checksum + value + (i & 7)) | 0;
  }
  return {
    checksum,
    counters,
    ms: performance.now() - start
  };
}

function createBindingHandle(scope, path, declaration, counters) {
  const targetScope = resolvePath(scope, path, counters);
  const cell = lookupDeclaration(targetScope, declaration, counters);
  return {
    scope,
    scopeVersion: scope.version,
    pathIdentity: path,
    targetScope,
    declaration,
    cell,
    canReuseEvaluatedValue: false,
    canReuseRenderedText: false
  };
}

function readBindingHandle(handle, counters) {
  if (handle.scope.version !== handle.scopeVersion) {
    throw new Error('Stale binding handle');
  }
  counters.valueReads++;
  return handle.cell.value;
}

function resolveCompoundReference(scope, path, declaration, counters) {
  const targetScope = resolvePath(scope, path, counters);
  const cell = lookupDeclaration(targetScope, declaration, counters);
  counters.valueReads++;
  return { targetScope, cell, value: cell.value };
}

function resolvePath(scope, path, counters) {
  let cursor = scope;
  for (let i = 0; i < path.length; i++) {
    counters.pathSegmentLookups++;
    cursor = cursor.children.get(path[i]);
    if (!cursor) {
      throw new Error(`Missing path segment: ${path[i]}`);
    }
  }
  return cursor;
}

function lookupDeclaration(scope, name, counters) {
  counters.declarationLookups++;
  const cell = scope.declarations.get(name);
  if (!cell) {
    throw new Error(`Missing declaration: ${name}`);
  }
  return cell;
}

function createScope(parent, name) {
  return {
    parent,
    name,
    version: 0,
    children: new Map(),
    declarations: new Map()
  };
}

function addChildScope(parent, name) {
  const child = createScope(parent, name);
  parent.children.set(name, child);
  bump(parent);
  return child;
}

function addDeclaration(scope, name, value) {
  const cell = { value };
  scope.declarations.set(name, cell);
  bump(scope);
  return cell;
}

function bump(scope) {
  let cursor = scope;
  while (cursor) {
    cursor.version++;
    cursor = cursor.parent;
  }
}

function createCounters() {
  return {
    pathSegmentLookups: 0,
    declarationLookups: 0,
    valueReads: 0
  };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75)
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function parseArgs(argv) {
  const parsed = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--references':
        parsed.references = readInt(argv, ++i, arg);
        break;
      case '--warmup':
        parsed.warmup = readInt(argv, ++i, arg);
        break;
      case '--repeat':
        parsed.repeat = readInt(argv, ++i, arg);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }
  return parsed;
}

function readInt(argv, index, name) {
  const raw = argv[index];
  if (!raw || raw.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}
