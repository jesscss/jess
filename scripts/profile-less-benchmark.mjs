#!/usr/bin/env node

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const lessRepoRoot = [
  process.env.LESS_REPO_ROOT,
  path.resolve(repoRoot, '../less.js'),
  '/Users/matthew/git/oss/less.js'
].find(candidate => candidate && existsSync(path.join(candidate, 'packages/less/benchmark')));

const cliArgs = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.split('=');
    return [key, value];
  })
);

const benchmarkArg = cliArgs.get('--fixture') ?? cliArgs.get('--file') ?? 'benchmark.less';
if (!cliArgs.has('--fixture') && !lessRepoRoot) {
  throw new Error('Pass --fixture or set LESS_REPO_ROOT to a Less checkout');
}
let benchmarkRoot = repoRoot;
if (!cliArgs.has('--fixture')) {
  benchmarkRoot = path.join(lessRepoRoot, 'packages/less/benchmark');
}
const benchmarkFile = path.isAbsolute(benchmarkArg)
  ? benchmarkArg
  : path.join(benchmarkRoot, benchmarkArg);
globalThis.__JESS_SERIALIZE_PROFILE_COUNTERS__ = {};
globalThis.__JESS_DIRECT_LOOKUP_PROFILE_COUNTERS__ = {};
globalThis.__JESS_MERGE_PROFILE_COUNTERS__ = {};

const coreLib = pathToFileURL(path.join(repoRoot, 'packages/core/lib/index.js')).href;
const lessParserLib = pathToFileURL(path.join(repoRoot, 'packages/less-parser/lib/index.js')).href;
const jessLib = pathToFileURL(path.join(repoRoot, 'packages/jess/lib/index.js')).href;
const lessPluginLib = pathToFileURL(path.join(repoRoot, 'packages/jess-plugin-less/lib/index.js')).href;
const lessCompatPluginLib = pathToFileURL(path.join(repoRoot, 'packages/jess-plugin-less-compat/lib/index.js')).href;

const stats = new Map();
const lookupStats = {
  rulesFindByType: new Map(),
  rulesFindByKey: new Map(),
  declarationCallerBySite: new Map(),
  registryFindByType: new Map(),
  registryFindByKey: new Map(),
  searchChildrenByType: new Map(),
  searchChildrenByKey: new Map(),
  referenceEvalByKey: new Map(),
  referenceEvalBySite: new Map()
};
const importStats = {
  getTreeCalls: 0,
  getTreeCacheHits: 0,
  getTreeCacheMisses: 0,
  parseCalls: 0,
  parseByRule: new Map(),
  getTreeByPath: new Map()
};

function getMetric(name) {
  let metric = stats.get(name);
  if (!metric) {
    metric = { count: 0, totalMs: 0 };
    stats.set(name, metric);
  }
  return metric;
}

function record(name, durationMs) {
  const metric = getMetric(name);
  metric.count++;
  metric.totalMs += durationMs;
}

function recordPath(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function normalizeLookupKey(value) {
  if (value instanceof Set) {
    return [...value].map(v => String(v)).sort().join('|');
  }
  if (Array.isArray(value)) {
    return value.map(v => String(v)).join('|');
  }
  return String(value);
}

function wrapMethod(proto, methodName, label, before) {
  if (!proto || !Object.prototype.hasOwnProperty.call(proto, methodName)) {
    return false;
  }
  const original = proto[methodName];
  if (typeof original !== 'function') {
    return false;
  }
  if (original.__instrumented) {
    return true;
  }
  const wrapped = function(...args) {
    before?.call(this, args);
    const start = performance.now();
    let result;
    try {
      result = original.apply(this, args);
    } catch (error) {
      record(label, performance.now() - start);
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        record(label, performance.now() - start);
      });
    }
    record(label, performance.now() - start);
    return result;
  };
  wrapped.__instrumented = true;
  proto[methodName] = wrapped;
  return true;
}

function printMap(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

const [
  { Node, Rules, Context, Reference },
  { Parser: LessParser },
  { Compiler },
  { default: lessPlugin },
  { lessCompatPlugin }
] = await Promise.all([
  import(coreLib),
  import(lessParserLib),
  import(jessLib),
  import(lessPluginLib),
  import(lessCompatPluginLib)
]);

wrapMethod(Node.prototype, 'clone', 'Node.clone');
wrapMethod(Node.prototype, 'copy', 'Node.copy');
wrapMethod(Node.prototype, 'cloneValue', 'Node.cloneValue');
wrapMethod(Reference.prototype, 'evalNode', 'Reference.evalNode', function() {
  const key = this?.value?.rawKey ?? this?.value?.key;
  const type = this?.options?.type ?? 'variable';
  const line = this?.location?.line ?? this?.source?.start?.line ?? '?';
  const column = this?.location?.column ?? this?.source?.start?.column ?? '?';
  const file = this?.location?.file ?? this?.source?.input?.from ?? 'unknown';
  recordPath(lookupStats.referenceEvalByKey, `${type}:${normalizeLookupKey(key)}`);
  recordPath(lookupStats.referenceEvalBySite, `${type}:${normalizeLookupKey(key)} @ ${path.basename(String(file))}:${line}:${column}`);
});

wrapMethod(Rules.prototype, 'find', 'Rules.find', function(args) {
  const [type, keys] = args;
  recordPath(lookupStats.rulesFindByType, String(type));
  recordPath(lookupStats.rulesFindByKey, `${String(type)}:${normalizeLookupKey(keys)}`);
  if (type === 'declaration') {
    const stack = new Error().stack?.split('\n') ?? [];
    const caller = stack
      .slice(2)
      .map(line => line.trim())
      .find(line => !line.includes('profile-less-benchmark.mjs'));
    if (caller) {
      recordPath(lookupStats.declarationCallerBySite, caller.replace(/^at\s+/, ''));
    }
  }
});
{
  const originalGetRegistry = Rules.prototype.getRegistry;
  Rules.prototype.getRegistry = function(...args) {
    const registry = originalGetRegistry.apply(this, args);
    if (registry?.constructor?.prototype) {
      const proto = registry.constructor.prototype;
      const prefix = registry.constructor.name || 'Registry';
      wrapMethod(proto, 'find', `${prefix}.find`, function(findArgs) {
        const [keys] = findArgs;
        recordPath(lookupStats.registryFindByType, prefix);
        recordPath(lookupStats.registryFindByKey, `${prefix}:${normalizeLookupKey(keys)}`);
      });
      wrapMethod(proto, '_searchRulesChildren', `${prefix}._searchRulesChildren`, function(childArgs) {
        const [keys] = childArgs;
        recordPath(lookupStats.searchChildrenByType, prefix);
        recordPath(lookupStats.searchChildrenByKey, `${prefix}:${normalizeLookupKey(keys)}`);
      });
      wrapMethod(proto, 'indexPendingItems', `${prefix}.indexPendingItems`);
    }
    return registry;
  };
}

{
  const originalGetTree = Context.prototype.getTree;
  Context.prototype.getTree = async function(...args) {
    importStats.getTreeCalls++;
    const [importPath] = args;
    recordPath(importStats.getTreeByPath, String(importPath));
    const sizeBefore = this.sourceTrees?.size ?? 0;
    const startMs = performance.now();
    try {
      return await originalGetTree.apply(this, args);
    } finally {
      const sizeAfter = this.sourceTrees?.size ?? 0;
      if (sizeAfter > sizeBefore) {
        importStats.getTreeCacheMisses++;
      } else {
        importStats.getTreeCacheHits++;
      }
      record('Context.getTree', performance.now() - startMs);
    }
  };
}

wrapMethod(LessParser.prototype, 'parse', 'LessParser.parse', function(args) {
  importStats.parseCalls++;
  const [, rule = 'stylesheet'] = args;
  recordPath(importStats.parseByRule, String(rule));
});

const start = performance.now();
const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [lessPlugin(), lessCompatPlugin()]
  }
});
await compiler.render(benchmarkFile);
const elapsedMs = performance.now() - start;
const serializeProfileCounters = globalThis.__JESS_SERIALIZE_PROFILE_COUNTERS__ ?? {};
const directLookupProfileCounters = globalThis.__JESS_DIRECT_LOOKUP_PROFILE_COUNTERS__ ?? {};
const mergeProfileCounters = globalThis.__JESS_MERGE_PROFILE_COUNTERS__ ?? {};

if (cliArgs.has('--assert-merge-contract')) {
  const containers = mergeProfileCounters.admissionCalls ?? 0;
  const admittedCalls = mergeProfileCounters.admittedCalls ?? 0;
  const calls = mergeProfileCounters.calls ?? 0;
  const featureBearingContainers = mergeProfileCounters.featureBearingContainers ?? 0;
  const failures = [
    ['calls <= admittedCalls', calls <= admittedCalls],
    ['admittedCalls <= featureBearingContainers', admittedCalls <= featureBearingContainers],
    ['featureBearingContainers < admissionCalls', featureBearingContainers < containers],
    ['admissionItemsVisited <= admissionCalls * 8', (mergeProfileCounters.admissionItemsVisited ?? 0) <= containers * 8],
    ['calls > 0 when feature-bearing containers exist', featureBearingContainers === 0 || calls > 0]
  ].filter(([, ok]) => !ok).map(([relation]) => relation);
  if (failures.length > 0) {
    throw new Error(
      `Merge cost contract failed: ${failures.join(', ')}; counters=${JSON.stringify(mergeProfileCounters)}`
    );
  }
}

if (cliArgs.has('--assert-duplicate-contract')) {
  const containers = serializeProfileCounters.duplicateDeclarationComparisonContainers ?? 0;
  const admittedCalls = serializeProfileCounters.duplicateDeclarationCountMapAllocations ?? 0;
  const itemsVisited = serializeProfileCounters.duplicateDeclarationRulesVisited ?? 0;
  const failures = [
    ['admittedCalls <= containers', admittedCalls <= containers],
    ['itemsVisited <= containers * 4', itemsVisited <= containers * 4]
  ].filter(([, ok]) => !ok).map(([relation]) => relation);
  if (failures.length > 0) {
    throw new Error(
      `Duplicate-declaration cost contract failed: ${failures.join(', ')}; counters=${JSON.stringify(serializeProfileCounters)}`
    );
  }
}

const metricRows = [...stats.entries()]
  .map(([name, metric]) => ({
    name,
    count: metric.count,
    totalMs: Number(metric.totalMs.toFixed(2)),
    avgMs: Number((metric.totalMs / metric.count).toFixed(4))
  }))
  .sort((a, b) => b.totalMs - a.totalMs);

const result = {
  benchmarkFile,
  compat: true,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  serializeStats: {
    duplicateDeclarationComparisonContainers: serializeProfileCounters.duplicateDeclarationComparisonContainers ?? 0,
    duplicateDeclarationPrerenderedDeclarations: serializeProfileCounters.duplicateDeclarationPrerenderedDeclarations ?? 0,
    emissionRenderNodeTextPreviewCalls: serializeProfileCounters.emissionRenderNodeTextPreviewCalls ?? 0,
    emissionRenderNodeTextRulesPreviewCalls: serializeProfileCounters.emissionRenderNodeTextRulesPreviewCalls ?? 0,
    emissionRenderNodeTextDeclarationFallbackCalls: serializeProfileCounters.emissionRenderNodeTextDeclarationFallbackCalls ?? 0,
    emissionRenderNodeTextLeafCalls: serializeProfileCounters.emissionRenderNodeTextLeafCalls ?? 0
  },
  mergeStats: {
    admissionCalls: mergeProfileCounters.admissionCalls ?? 0,
    admissionItemsVisited: mergeProfileCounters.admissionItemsVisited ?? 0,
    admittedCalls: mergeProfileCounters.admittedCalls ?? 0,
    calls: mergeProfileCounters.calls ?? 0,
    featureBearingContainers: mergeProfileCounters.featureBearingContainers ?? 0,
    noFeatureMisses: Math.max(
      0,
      (mergeProfileCounters.admissionCalls ?? 0) - (mergeProfileCounters.admittedCalls ?? 0)
    ),
    noFeatureAllocations: 0
  },
  importStats: {
    getTreeCalls: importStats.getTreeCalls,
    getTreeCacheHits: importStats.getTreeCacheHits,
    getTreeCacheMisses: importStats.getTreeCacheMisses,
    parseCalls: importStats.parseCalls,
    parseByRule: Object.fromEntries(printMap(importStats.parseByRule, 20)),
    topImportPaths: Object.fromEntries(printMap(importStats.getTreeByPath, 20))
  },
  lookupStats: {
    rulesFindByType: Object.fromEntries(printMap(lookupStats.rulesFindByType, 20)),
    topRulesFindKeys: Object.fromEntries(printMap(lookupStats.rulesFindByKey, 30)),
    topDeclarationCallers: Object.fromEntries(printMap(lookupStats.declarationCallerBySite, 30)),
    registryFindByType: Object.fromEntries(printMap(lookupStats.registryFindByType, 20)),
    topRegistryFindKeys: Object.fromEntries(printMap(lookupStats.registryFindByKey, 30)),
    searchChildrenByType: Object.fromEntries(printMap(lookupStats.searchChildrenByType, 20)),
    topSearchChildrenKeys: Object.fromEntries(printMap(lookupStats.searchChildrenByKey, 30)),
    directLookupCounters: Object.fromEntries(printMap(new Map(Object.entries(directLookupProfileCounters)), 40)),
    topReferenceEvalKeys: Object.fromEntries(printMap(lookupStats.referenceEvalByKey, 30)),
    topReferenceEvalSites: Object.fromEntries(printMap(lookupStats.referenceEvalBySite, 40))
  },
  topMetrics: metricRows.slice(0, 40)
};

console.log(JSON.stringify(result, null, 2));
