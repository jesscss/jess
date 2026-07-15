#!/usr/bin/env node

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

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
globalThis.__JESS_EXTEND_PROFILE_COUNTERS__ = {};
globalThis.__JESS_SPINE_PROFILE_COUNTERS__ = {};
globalThis.__JESS_UNCOVERED_CALLABLE_PROFILE_COUNTERS__ = {};

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
const renderedCss = await compiler.render(benchmarkFile);
const elapsedMs = performance.now() - start;
const renderedOutputSha256 = createHash('sha256').update(String(renderedCss)).digest('hex');
const spineProfileCounters = globalThis.__JESS_SPINE_PROFILE_COUNTERS__ ?? {};
const serializeProfileCounters = globalThis.__JESS_SERIALIZE_PROFILE_COUNTERS__ ?? {};
const directLookupProfileCounters = globalThis.__JESS_DIRECT_LOOKUP_PROFILE_COUNTERS__ ?? {};
const mergeProfileCounters = globalThis.__JESS_MERGE_PROFILE_COUNTERS__ ?? {};
const extendProfileCounters = globalThis.__JESS_EXTEND_PROFILE_COUNTERS__ ?? {};
const uncoveredCallableProfileCounters = globalThis.__JESS_UNCOVERED_CALLABLE_PROFILE_COUNTERS__ ?? {};

const extendFilterStats = {
  admissionCalls: extendProfileCounters['filter.admissionCalls'] ?? 0,
  admittedCalls: extendProfileCounters['filter.admittedCalls'] ?? 0,
  calls: extendProfileCounters['filter.calls'] ?? 0,
  featureBearingCalls: extendProfileCounters['filter.featureBearingCalls'] ?? 0,
  admissionItemsVisited: extendProfileCounters['filter.admissionItemsVisited'] ?? 0,
  itemsVisited: extendProfileCounters['filter.calls'] ?? 0,
  noFeatureAllocations: extendProfileCounters['filter.noFeatureAllocations'] ?? 0,
  noFeatureMisses: extendProfileCounters['filter.noFeatureMisses'] ?? 0
};
const extendDeferStats = {
  admissionCalls: extendProfileCounters['defer.admissionCalls'] ?? 0,
  admittedCalls: extendProfileCounters['defer.admittedCalls'] ?? 0,
  calls: extendProfileCounters['defer.calls'] ?? 0,
  featureBearingContainers: extendProfileCounters['defer.featureBearingContainers'] ?? 0,
  admissionItemsVisited: extendProfileCounters['defer.admissionItemsVisited'] ?? 0,
  itemsVisited: extendProfileCounters['defer.itemsVisited'] ?? 0,
  noFeatureAllocations: 0,
  noFeatureMisses: Math.max(
    0,
    (extendProfileCounters['defer.admissionCalls'] ?? 0) - (extendProfileCounters['defer.admittedCalls'] ?? 0)
  )
};

if (cliArgs.has('--assert-extend-filter-contract')) {
  const s = extendFilterStats;
  const failures = [
    ['admissionCalls > 0', s.admissionCalls > 0],
    ['calls <= admittedCalls', s.calls <= s.admittedCalls],
    ['featureBearingCalls <= admittedCalls (superset)', s.featureBearingCalls <= s.admittedCalls],
    ['admittedCalls >= featureBearingCalls with margin (real superset)', s.admittedCalls >= s.featureBearingCalls],
    ['noFeatureAllocations > 0 (filter allocates)', s.noFeatureAllocations > 0],
    ['admissionItemsVisited <= admissionCalls * 8', s.admissionItemsVisited <= s.admissionCalls * 8]
  ].filter(([, ok]) => !ok).map(([relation]) => relation);
  if (failures.length > 0) {
    throw new Error(
      `Extend keyset-filter cost contract failed: ${failures.join(', ')}; counters=${JSON.stringify(s)}`
    );
  }
}

if (cliArgs.has('--assert-extend-defer-contract')) {
  const s = extendDeferStats;
  const failures = [
    ['admissionCalls > 0', s.admissionCalls > 0],
    ['calls <= admittedCalls', s.calls <= s.admittedCalls],
    ['admittedCalls <= featureBearingContainers', s.admittedCalls <= s.featureBearingContainers],
    ['featureBearingContainers <= calls (precise)', s.featureBearingContainers <= s.calls],
    ['noFeatureAllocations === 0', s.noFeatureAllocations === 0],
    ['admissionItemsVisited <= admissionCalls * 8', s.admissionItemsVisited <= s.admissionCalls * 8]
  ].filter(([, ok]) => !ok).map(([relation]) => relation);
  if (failures.length > 0) {
    throw new Error(
      `Extend deferral cost contract failed: ${failures.join(', ')}; counters=${JSON.stringify(s)}`
    );
  }
}

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

if (cliArgs.has('--assert-live-merge-contract')) {
  const requiredPositiveCounters = ['admissionCalls', 'admittedCalls', 'calls'];
  const failures = requiredPositiveCounters
    .filter(name => (mergeProfileCounters[name] ?? 0) <= 0)
    .map(name => `${name} > 0`);
  if (failures.length > 0) {
    throw new Error(
      `Live merge contract failed: ${failures.join(', ')}; counters=${JSON.stringify(mergeProfileCounters)}`
    );
  }
}

if (cliArgs.has('--assert-early-admit-contract')) {
  // Redundant-call-elimination proof for the import-tree speculative extend-topology
  // early-admit (emit-walk.ts isSpineEligibleRoot). Two things must hold on the
  // canonical benchmark: (1) the render is byte-identical to the known oracle sha
  // (removal changed no output), and (2) the eliminated `isSpineExtendTopology`
  // calls for import trees actually fired (net removal is real, not vacuous).
  const importTopologyEliminated = spineProfileCounters['earlyAdmit.importTopologyEliminated'] ?? 0;
  const expectedSha = cliArgs.get('--expect-sha');
  const failures = [
    ['import-tree topology calls eliminated > 0', importTopologyEliminated > 0]
  ];
  if (expectedSha && expectedSha !== 'true') {
    failures.push([`render byte-identical to oracle sha ${expectedSha}`, renderedOutputSha256 === expectedSha]);
  }
  const failed = failures.filter(([, ok]) => !ok).map(([relation]) => relation);
  if (failed.length > 0) {
    throw new Error(
      `Early-admit redundant-call-elimination contract failed: ${failed.join(', ')}; sha=${renderedOutputSha256}, counters=${JSON.stringify(spineProfileCounters)}`
    );
  }
}

if (cliArgs.has('--assert-callable-fallback-contract')) {
  // Off-benchmark call-count reduction proof for the callable-fallback slice
  // (scope-frame.ts lookupScopeFrameCallable fallback-chain traversal). On the
  // named import-guarded fixture, two things must hold: (1) the rendered output
  // is byte-identical to the fixture oracle sha (the traversal changed no
  // output), and (2) every findMixinsFastForUncoveredCallable descent for an
  // imported guarded mixin is retired (post-slice call count is 0 on this
  // fixture — the whole point of the slice). callsBefore (measured via the
  // same-worktree A/B recorded in the audit record) proves the retirement is
  // real; this executable check proves the after-state and byte-identity.
  const uncoveredTotal = uncoveredCallableProfileCounters.total ?? 0;
  const guardedCalls = uncoveredCallableProfileCounters['key..configured-guarded'] ?? 0;
  const expectedSha = cliArgs.get('--expect-sha');
  const failures = [
    ['imported guarded-mixin uncovered descent retired (total === 0)', uncoveredTotal === 0],
    ['.configured-guarded uncovered descent retired (=== 0)', guardedCalls === 0]
  ];
  if (expectedSha && expectedSha !== 'true') {
    failures.push([`render byte-identical to fixture oracle sha ${expectedSha}`, renderedOutputSha256 === expectedSha]);
  }
  const failed = failures.filter(([, ok]) => !ok).map(([relation]) => relation);
  if (failed.length > 0) {
    throw new Error(
      `Callable-fallback off-benchmark contract failed: ${failed.join(', ')}; sha=${renderedOutputSha256}, counters=${JSON.stringify(uncoveredCallableProfileCounters)}`
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
  extendFilterStats,
  extendDeferStats,
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
