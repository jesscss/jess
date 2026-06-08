#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const options = {
    depth: 80,
    namesPerScope: 12,
    lookups: 200_000,
    mode: 'registry',
    pairs: 60,
    phase: 'lookup',
    warmup: 8
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--depth':
        options.depth = readInt(argv, ++i, arg);
        break;
      case '--names':
        options.namesPerScope = readInt(argv, ++i, arg);
        break;
      case '--lookups':
        options.lookups = readInt(argv, ++i, arg);
        break;
      case '--mode':
        options.mode = readValue(argv, ++i, arg);
        break;
      case '--pairs':
        options.pairs = readInt(argv, ++i, arg);
        break;
      case '--phase':
        options.phase = readValue(argv, ++i, arg);
        break;
      case '--warmup':
        options.warmup = readInt(argv, ++i, arg);
        break;
      default:
        throw new Error(`Unknown arg: ${arg}`);
    }
  }

  if (options.phase !== 'lookup' && options.phase !== 'build-lookup') {
    throw new Error('--phase must be lookup or build-lookup');
  }
  if (
    options.mode !== 'registry'
    && options.mode !== 'registry-count'
    && options.mode !== 'frame-materialize'
  ) {
    throw new Error('--mode must be registry, registry-count, or frame-materialize');
  }
  return options;
}

function readValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readInt(argv, index, name) {
  const value = Number(readValue(argv, index, name));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length < 2
    ? 0
    : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return {
    mean,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stddev: Math.sqrt(variance)
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

function makeNames(count) {
  const names = new Array(count);
  for (let i = 0; i < count; i++) {
    names[i] = `.m${i}`;
  }
  return names;
}

function makeLookupKeys(options) {
  const hotNames = makeNames(options.namesPerScope);
  const keys = new Array(options.lookups);
  for (let i = 0; i < keys.length; i++) {
    const scopeOffset = i % options.depth;
    const nameOffset = (i * 17) % options.namesPerScope;
    keys[i] = {
      name: hotNames[nameOffset],
      depthFromLeaf: scopeOffset
    };
  }
  return keys;
}

class RegistryBucket {
  constructor() {
    this.index = new Map();
    this.pendingItems = [];
  }

  add(item) {
    this.pendingItems.push(item);
  }

  indexPendingItems() {
    const pending = this.pendingItems;
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      let bucket = this.index.get(item.name);
      if (!bucket) {
        bucket = [];
        this.index.set(item.name, bucket);
      }
      bucket.push(item);
    }
    pending.length = 0;
  }

  find(name, materialize) {
    this.indexPendingItems();
    const bucket = this.index.get(name);
    if (!bucket) {
      return materialize ? undefined : 0;
    }
    if (!materialize) {
      return bucket.length;
    }
    const out = new Array(bucket.length);
    for (let i = bucket.length - 1, write = 0; i >= 0; i--, write++) {
      out[write] = bucket[i];
    }
    return out;
  }
}

class RegistryScope {
  constructor(parent) {
    this.parent = parent;
    this.mixinRegistry = new RegistryBucket();
  }

  register(item) {
    this.mixinRegistry.add(item);
  }

  findMixin(name, depthFromLeaf, materialize = true) {
    let cursor = this;
    let remaining = depthFromLeaf;
    while (cursor && remaining > 0) {
      cursor = cursor.parent;
      remaining--;
    }
    if (!cursor) {
      return 0;
    }

    let hits = 0;
    const searched = new Set();
    while (cursor) {
      if (searched.has(cursor)) {
        break;
      }
      searched.add(cursor);
      const found = cursor.mixinRegistry.find(name, materialize);
      if (materialize && found) {
        hits += found.length;
      } else if (!materialize) {
        hits += found;
      }
      cursor = cursor.parent;
    }
    return hits;
  }
}

class FrameScope {
  constructor(parent, mixinsByName) {
    this.parent = parent;
    this.mixinsByName = mixinsByName;
  }

  findMixin(name, depthFromLeaf, materialize = false) {
    let cursor = this;
    let remaining = depthFromLeaf;
    while (cursor && remaining > 0) {
      cursor = cursor.parent;
      remaining--;
    }
    let hits = 0;
    while (cursor) {
      const bucket = cursor.mixinsByName.get(name);
      if (bucket) {
        if (materialize) {
          const out = new Array(bucket.length);
          for (let i = bucket.length - 1, write = 0; i >= 0; i--, write++) {
            out[write] = bucket[i];
          }
          hits += out.length;
          cursor = cursor.parent;
          continue;
        }
        hits += bucket.length;
      }
      cursor = cursor.parent;
    }
    return hits;
  }
}

function buildRegistryScopes(options) {
  const names = makeNames(options.namesPerScope);
  let parent;
  for (let depth = 0; depth < options.depth; depth++) {
    const scope = new RegistryScope(parent);
    for (let i = 0; i < names.length; i++) {
      scope.register({
        name: names[i],
        scope: depth,
        ordinal: i
      });
    }
    parent = scope;
  }
  return parent;
}

function buildFrameScopes(options) {
  const names = makeNames(options.namesPerScope);
  let parent;
  for (let depth = 0; depth < options.depth; depth++) {
    const mixinsByName = new Map();
    for (let i = 0; i < names.length; i++) {
      mixinsByName.set(names[i], [{
        name: names[i],
        scope: depth,
        ordinal: i
      }]);
    }
    parent = new FrameScope(parent, mixinsByName);
  }
  return parent;
}

function runLookups(scope, keys, materialize) {
  let hits = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    hits += scope.findMixin(key.name, key.depthFromLeaf, materialize);
  }
  return hits;
}

function timeRegistry(options, keys) {
  const start = performance.now();
  const scope = buildRegistryScopes(options);
  const lookupStart = options.phase === 'lookup' ? performance.now() : start;
  const hits = runLookups(scope, keys, options.mode !== 'registry-count');
  return {
    elapsedMs: performance.now() - lookupStart,
    hits
  };
}

function timeFrame(options, keys) {
  const start = performance.now();
  const scope = buildFrameScopes(options);
  const lookupStart = options.phase === 'lookup' ? performance.now() : start;
  const hits = runLookups(scope, keys, options.mode === 'frame-materialize');
  return {
    elapsedMs: performance.now() - lookupStart,
    hits
  };
}

const options = parseArgs(process.argv.slice(2));
const keys = makeLookupKeys(options);

for (let i = 0; i < options.warmup; i++) {
  const registry = timeRegistry(options, keys);
  const frame = timeFrame(options, keys);
  if (registry.hits !== frame.hits) {
    throw new Error(`Hit mismatch during warmup: registry=${registry.hits} frame=${frame.hits}`);
  }
}

const pairs = [];
for (let i = 0; i < options.pairs; i++) {
  const frameFirst = i % 2 === 1;
  let registry;
  let frame;
  if (frameFirst) {
    frame = timeFrame(options, keys);
    registry = timeRegistry(options, keys);
  } else {
    registry = timeRegistry(options, keys);
    frame = timeFrame(options, keys);
  }
  if (registry.hits !== frame.hits) {
    throw new Error(`Hit mismatch: registry=${registry.hits} frame=${frame.hits}`);
  }
  pairs.push({
    registryMs: registry.elapsedMs,
    frameMs: frame.elapsedMs,
    deltaMs: frame.elapsedMs - registry.elapsedMs,
    ratio: (frame.elapsedMs - registry.elapsedMs) / registry.elapsedMs
  });
}

const registry = summarize(pairs.map(pair => pair.registryMs));
const frame = summarize(pairs.map(pair => pair.frameMs));
const deltas = summarize(pairs.map(pair => pair.deltaMs));
const ratios = summarize(pairs.map(pair => pair.ratio));
const wins = pairs.filter(pair => pair.frameMs < pair.registryMs).length;
const standardError = deltas.stddev / Math.sqrt(pairs.length);

console.log(`no-registry prototype phase=${options.phase} mode=${options.mode} depth=${options.depth} names=${options.namesPerScope} lookups=${options.lookups} pairs=${options.pairs}`);
console.log(`registry median=${registry.median.toFixed(2)}ms mean=${registry.mean.toFixed(2)}ms`);
console.log(`frame median=${frame.median.toFixed(2)}ms mean=${frame.mean.toFixed(2)}ms`);
console.log(`delta median=${deltas.median.toFixed(2)}ms mean=${deltas.mean.toFixed(2)}ms t=${(standardError === 0 ? 0 : deltas.mean / standardError).toFixed(2)}`);
console.log(`ratio median=${(ratios.median * 100).toFixed(2)}% mean=${(ratios.mean * 100).toFixed(2)}% frameWins=${wins}/${pairs.length}`);
