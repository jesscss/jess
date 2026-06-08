#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

import { N, any, decl, isNode, rules, vardecl } from '../packages/core/lib/index.js';

function parseArgs(argv) {
  const options = {
    childRules: 16,
    declarations: 64,
    keyMode: 'mixed',
    lookups: 200000,
    pairs: 60,
    scopeFrame: false,
    warmup: 8
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[++i];
    if (next === undefined) {
      throw new Error(`${arg} requires a value`);
    }
    switch (arg) {
      case '--child-rules':
        options.childRules = Number(next);
        break;
      case '--declarations':
        options.declarations = Number(next);
        break;
      case '--key-mode':
        options.keyMode = next;
        if (!['mixed', 'vars', 'properties'].includes(options.keyMode)) {
          throw new Error('--key-mode must be mixed, vars, or properties');
        }
        break;
      case '--lookups':
        options.lookups = Number(next);
        break;
      case '--pairs':
        options.pairs = Number(next);
        break;
      case '--scope-frame':
        options.scopeFrame = next === '1' || next === 'true';
        break;
      case '--warmup':
        options.warmup = Number(next);
        break;
      default:
        throw new Error(`Unknown arg ${arg}`);
    }
  }
  return options;
}

function buildTree(options) {
  const rootChildren = [];
  for (let i = 0; i < options.declarations; i++) {
    rootChildren.push(vardecl({ name: `root-${i}`, value: any(`${i}`) }));
    rootChildren.push(decl({ name: `prop-${i}`, value: any(`${i}`) }));
  }
  for (let c = 0; c < options.childRules; c++) {
    const child = [];
    for (let i = 0; i < options.declarations; i++) {
      child.push(vardecl({ name: `child-${c}-var-${i}`, value: any(`${c}-${i}`) }));
      child.push(decl({ name: `child-${c}-prop-${i}`, value: any(`${c}-${i}`) }));
    }
    rootChildren.push(rules(child, {
      rulesVisibility: {
        Declaration: 'public',
        VarDeclaration: 'optional'
      }
    }));
  }
  const leaf = rules([
    decl({ name: 'leaf-prop', value: any('leaf') })
  ]);
  rootChildren.push(leaf);
  return { root: rules(rootChildren), leaf };
}

function childRulesOf(node) {
  if (isNode(node, N.Rules)) {
    return node;
  }
  if (isNode(node, N.Ruleset) || isNode(node, N.Mixin)) {
    return node.value.rules;
  }
  if (isNode(node, N.AtRule)) {
    return node.value.rules;
  }
  return undefined;
}

function prepareScopeFrames(scope, visited = new Set()) {
  if (visited.has(scope)) {
    return;
  }
  visited.add(scope);
  scope.getScopeFrame();
  for (let i = 0; i < scope.value.length; i++) {
    const childRules = childRulesOf(scope.value[i]);
    if (childRules) {
      prepareScopeFrames(childRules, visited);
    }
  }
}

function buildKeys(options) {
  const keys = [];
  for (let i = 0; i < options.declarations; i++) {
    if (options.keyMode !== 'vars') {
      keys.push({ key: `prop-${i}`, filter: 'Declaration' });
    }
    if (options.keyMode !== 'properties') {
      keys.push({ key: `root-${i}`, filter: 'VarDeclaration' });
    }
  }
  for (let c = 0; c < options.childRules; c++) {
    const index = c % options.declarations;
    if (options.keyMode !== 'vars') {
      keys.push({ key: `child-${c}-prop-${index}`, filter: 'Declaration' });
    }
    if (options.keyMode !== 'properties') {
      keys.push({ key: `child-${c}-var-${index}`, filter: 'VarDeclaration' });
    }
  }
  return keys;
}

function runLookupBatch(tree, keys, options, flagValue) {
  process.env.JESS_DIRECT_DECLARATION_LOOKUP = flagValue;
  let hits = 0;
  const start = performance.now();
  for (let i = 0; i < options.lookups; i++) {
    const item = keys[i % keys.length];
    const found = tree.leaf.find('declaration', item.key, item.filter, { searchParents: true });
    if (found) {
      hits++;
    }
  }
  return { ms: performance.now() - start, hits };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = values.length < 2
    ? 0
    : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, median, stddev: Math.sqrt(variance) };
}

const options = parseArgs(process.argv.slice(2));
const baselineTree = buildTree(options);
const candidateTree = buildTree(options);
const keys = buildKeys(options);

if (options.scopeFrame) {
  prepareScopeFrames(baselineTree.root);
  prepareScopeFrames(candidateTree.root);
}

for (let i = 0; i < options.warmup; i++) {
  runLookupBatch(baselineTree, keys, options, '0');
  runLookupBatch(candidateTree, keys, options, '1');
}

const pairs = [];
for (let i = 0; i < options.pairs; i++) {
  const candidateFirst = i % 2 === 1;
  const first = runLookupBatch(candidateFirst ? candidateTree : baselineTree, keys, options, candidateFirst ? '1' : '0');
  const second = runLookupBatch(candidateFirst ? baselineTree : candidateTree, keys, options, candidateFirst ? '0' : '1');
  const baseline = candidateFirst ? second : first;
  const candidate = candidateFirst ? first : second;
  if (baseline.hits !== candidate.hits) {
    throw new Error(`Hit mismatch: baseline=${baseline.hits} candidate=${candidate.hits}`);
  }
  pairs.push({ baselineMs: baseline.ms, candidateMs: candidate.ms, deltaMs: candidate.ms - baseline.ms });
}

const baseline = summarize(pairs.map(pair => pair.baselineMs));
const candidate = summarize(pairs.map(pair => pair.candidateMs));
const deltas = summarize(pairs.map(pair => pair.deltaMs));
const wins = pairs.filter(pair => pair.candidateMs < pair.baselineMs).length;
const standardError = deltas.stddev / Math.sqrt(pairs.length);
const t = standardError === 0 ? 0 : deltas.mean / standardError;
console.log(`direct declaration lookup prototype childRules=${options.childRules} declarations=${options.declarations} keyMode=${options.keyMode} lookups=${options.lookups} pairs=${options.pairs} scopeFrame=${options.scopeFrame ? 1 : 0}`);
console.log(`baseline median=${baseline.median.toFixed(2)}ms mean=${baseline.mean.toFixed(2)}ms`);
console.log(`candidate median=${candidate.median.toFixed(2)}ms mean=${candidate.mean.toFixed(2)}ms`);
console.log(`delta median=${deltas.median.toFixed(2)}ms mean=${deltas.mean.toFixed(2)}ms t=${t.toFixed(2)} wins=${wins}/${pairs.length}`);
