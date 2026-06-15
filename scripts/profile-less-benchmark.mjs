#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const lessRepoRoot = path.resolve(repoRoot, '../less.js');
const lessPkgRoot = path.join(lessRepoRoot, 'packages/less');

const cliArgs = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.split('=');
    return [key, value];
  })
);

const benchmarkArg = cliArgs.get('--fixture') ?? cliArgs.get('--file') ?? 'benchmark.less';
const benchmarkRoot = cliArgs.has('--fixture') ? repoRoot : path.join(lessPkgRoot, 'benchmark');
const benchmarkFile = path.isAbsolute(benchmarkArg)
  ? benchmarkArg
  : path.join(benchmarkRoot, benchmarkArg);
const useCompat = cliArgs.get('--compat') !== 'false';
globalThis.__JESS_SERIALIZE_PROFILE_COUNTERS__ = {};

const coreLib = pathToFileURL(path.join(repoRoot, 'packages/core/lib/index.js')).href;
const lessParserLib = pathToFileURL(path.join(repoRoot, 'packages/less-parser/lib/index.js')).href;
const lessFacadeLib = pathToFileURL(path.join(lessPkgRoot, 'lib/index.js')).href;
const jessLib = pathToFileURL(path.join(repoRoot, 'packages/jess/lib/index.js')).href;

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

const [{ Node, OutputWriter, Rules, Context, Reference }, { Parser: LessParser }, { Compiler }] = await Promise.all([
  import(coreLib),
  import(lessParserLib),
  import(jessLib)
]);

wrapMethod(OutputWriter.prototype, 'mark', 'OutputWriter.mark');
wrapMethod(OutputWriter.prototype, 'getSince', 'OutputWriter.getSince');
wrapMethod(OutputWriter.prototype, 'restore', 'OutputWriter.restore');
wrapMethod(OutputWriter.prototype, 'capture', 'OutputWriter.capture');

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

const source = await fs.readFile(benchmarkFile, 'utf8');
const start = performance.now();
if (useCompat) {
  const less = (await import(lessFacadeLib)).default;
  await new Promise((resolve, reject) => {
    less.render(
      source,
      {
        filename: benchmarkFile,
        paths: [path.dirname(benchmarkFile)],
        math: 'always'
      },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
} else {
  const config = {
    compile: {
      mathMode: 'always',
      searchPaths: [path.dirname(benchmarkFile)],
      plugins: []
    },
    output: {},
    language: {}
  };
  const compiler = new Compiler(config);
  await compiler.renderToResult(
    { source, filePath: benchmarkFile, language: 'less', extension: '.less' },
    config
  );
}
const elapsedMs = performance.now() - start;
const serializeProfileCounters = globalThis.__JESS_SERIALIZE_PROFILE_COUNTERS__ ?? {};

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
  compat: useCompat,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  serializeStats: {
    duplicateDeclarationComparisonContainers: serializeProfileCounters.duplicateDeclarationComparisonContainers ?? 0,
    duplicateDeclarationPrerenderedDeclarations: serializeProfileCounters.duplicateDeclarationPrerenderedDeclarations ?? 0,
    duplicateDeclarationCachedOutputReuses: serializeProfileCounters.duplicateDeclarationCachedOutputReuses ?? 0,
    emissionRenderNodeTextPreviewCalls: serializeProfileCounters.emissionRenderNodeTextPreviewCalls ?? 0,
    emissionRenderNodeTextRulesPreviewCalls: serializeProfileCounters.emissionRenderNodeTextRulesPreviewCalls ?? 0,
    emissionRenderNodeTextDeclarationFallbackCalls: serializeProfileCounters.emissionRenderNodeTextDeclarationFallbackCalls ?? 0,
    emissionRenderNodeTextLeafCalls: serializeProfileCounters.emissionRenderNodeTextLeafCalls ?? 0
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
    topReferenceEvalKeys: Object.fromEntries(printMap(lookupStats.referenceEvalByKey, 30)),
    topReferenceEvalSites: Object.fromEntries(printMap(lookupStats.referenceEvalBySite, 40))
  },
  topMetrics: metricRows.slice(0, 40)
};

console.log(JSON.stringify(result, null, 2));
