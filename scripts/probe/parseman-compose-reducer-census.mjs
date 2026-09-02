#!/usr/bin/env node
/*
 * Per-reducer blast-radius census for production-level `compose()`.
 *
 * Companion to `scripts/probe/parseman-compose-feasibility.mjs` and the record in
 * `docs/architecture/parser/PRODUCTION-COMPOSE-FEASIBILITY.md`. Where that probe
 * runs synthetic control/treatment pairs plus a coarse file-level swap, THIS one
 * measures each grammar's per-reducer blast radius directly: it drives parseman's
 * OWN classifier `directBuilderBindings(reducerSrc)` — the exact function the plugin
 * uses to decide structural-vs-free (in 0.50.4 at plugin/index.js:17093, called at
 * :17731) — over every inline node() reducer in each grammar, and splits free names:
 *   - carried   : a non-macro imported binding in grammar.ts -> _builderImports resolves it, emitted as a carried import
 *   - unresolved: NOT imported (module-scope local helper / unknown) -> becomes staticError -> REJECT
 * A reducer is REJECTED iff structural>0 OR any free name is unresolved. This mirrors
 * plugin/index.js:17731-17743 exactly. Read-only w.r.t. shipped grammars.
 *
 * Run after any parseman bump:  node scripts/probe/parseman-compose-reducer-census.mjs
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import module from 'node:module';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = module.createRequire(pathToFileURL(join(repo, 'x.js')));
const pluginPath = require.resolve('parseman/plugin');

let src = readFileSync(pluginPath, 'utf8');
src += `\nexport { directBuilderBindings, parseSync };\n`;
const patched = join(dirname(pluginPath), `__census2_${process.pid}.mjs`);
writeFileSync(patched, src);
process.on('exit', () => {
  try {
    rmSync(patched, { force: true });
  } catch {}
});
const { directBuilderBindings, parseSync } = await import(pathToFileURL(patched));

const MACRO_SOURCES = new Set(['parseman']);

function analyzeGrammar(rel) {
  const file = join(repo, rel);
  const code = readFileSync(file, 'utf8');
  const { program, errors } = parseSync(file, code);
  if (errors && errors.length) {
    // TS type-only errors from oxc are usually benign; only bail on hard parse failures
  }

  // Build importBindings exactly like the plugin: non-macro ImportSpecifier local names.
  const importedNames = new Set();
  for (const stmt of program.body) {
    if (stmt.type !== 'ImportDeclaration') {
      continue;
    }
    const isMacro = MACRO_SOURCES.has(stmt.source.value)
      && (stmt.attributes || []).some(a => (a.key.name ?? a.key.value) === 'type' && a.value.value === 'macro');
    if (isMacro) {
      continue;
    }
    for (const spec of stmt.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        importedNames.add(spec.local.name);
      }
    }
  }

  const reducers = []; // { rule, src, structural, free, unresolvedFree, carriedFree, rejected }
  let ruleStack = [];

  const slice = n => code.slice(n.start, n.end);

  const isFn = n => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression');

  function recordNodeCall(call) {
    const args = call.arguments || [];
    if (!args.length) {
      return;
    }
    const first = args[0];
    const explicitType = first && first.type === 'Literal' && typeof first.value === 'string';
    const buildArg = explicitType ? args[2] : args[1];
    if (!isFn(buildArg)) {
      return;
    } // options object or no reducer -> no builder to reject
    const rsrc = slice(buildArg);
    let report;
    try {
      report = directBuilderBindings(rsrc);
    } catch (e) {
      report = { structural: ['ANALYZER-THREW:' + e.message.slice(0, 40)], free: [] };
    }
    const free = report.free;
    const unresolvedFree = free.filter(n => !importedNames.has(n));
    const carriedFree = free.filter(n => importedNames.has(n));
    const rejected = report.structural.length > 0 || unresolvedFree.length > 0;
    reducers.push({
      rule: ruleStack[ruleStack.length - 1] ?? '(anon)',
      structural: report.structural, free, unresolvedFree, carriedFree, rejected
    });
  }

  // Walk AST, tracking nearest enclosing object-property key as the "rule name".
  function walk(node, keyName) {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const c of node) {
        walk(c, keyName);
      }
      return;
    }
    if (typeof node.type !== 'string') {
      return;
    }

    let pushed = false;
    if (node.type === 'Property') {
      const k = node.key;
      const name = k ? (k.name ?? (typeof k.value === 'string' ? k.value : undefined)) : undefined;
      if (name && isFn(node.value) === false) {
        ruleStack.push(name);
        pushed = true;
      }
    }
    if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' && node.callee.name === 'node') {
      recordNodeCall(node);
    }
    for (const key of Object.keys(node)) {
      if (key === 'start' || key === 'end' || key === 'type' || key === 'parent') {
        continue;
      }
      walk(node[key], keyName);
    }
    if (pushed) {
      ruleStack.pop();
    }
  }
  walk(program, undefined);

  // Aggregate — count REJECTED REDUCERS (robust; one builder ~ one production).
  const rejected = reducers.filter(r => r.rejected);
  const structuralRejects = rejected.filter(r => r.structural.length > 0);
  const bindingOnlyRejects = rejected.filter(r => r.structural.length === 0 && r.unresolvedFree.length > 0);

  const rejectedReducers = rejected.length;
  const structuralReducers = structuralRejects.length;
  const bindingOnlyReducers = bindingOnlyRejects.length;

  const distinctRejectedRules = new Set(rejected.map(r => r.rule));
  const distinctStructuralRules = new Set(structuralRejects.map(r => r.rule));
  const distinctBindingOnlyRules = new Set(bindingOnlyRejects.filter(r => !distinctStructuralRules.has(r.rule)).map(r => r.rule));

  const freeUnion = new Set();
  for (const r of reducers) {
    for (const f of r.free) {
      freeUnion.add(f);
    }
  }
  const unresolvedUnion = new Set();
  for (const r of reducers) {
    for (const f of r.unresolvedFree) {
      unresolvedUnion.add(f);
    }
  }
  const carriedUnion = new Set();
  for (const r of reducers) {
    for (const f of r.carriedFree) {
      carriedUnion.add(f);
    }
  }

  const structuralHist = {};
  for (const r of structuralRejects) {
    for (const s of r.structural) {
      structuralHist[s] = (structuralHist[s] || 0) + 1;
    }
  }

  return {
    rel, totalReducers: reducers.length,
    rejectedReducers, structuralReducers, bindingOnlyReducers,
    distinctRejectedRules: distinctRejectedRules.size,
    distinctStructuralRules: distinctStructuralRules.size,
    distinctBindingOnlyRules: distinctBindingOnlyRules.size,
    distinctFree: freeUnion.size, distinctUnresolved: unresolvedUnion.size, distinctCarried: carriedUnion.size,
    structuralHist,
    topUnresolved: [...unresolvedUnion].sort(),
    sampleStructural: structuralRejects.slice(0, 8).map(r => `${r.rule}:[${r.structural.join(',')}]`)
  };
}

const grammars = [
  ['css',  'packages/syntax/css/css-parser/src/grammar.ts'],
  ['less', 'packages/syntax/less/less-parser/src/grammar.ts'],
  ['scss', 'packages/syntax/scss/scss-parser/src/grammar.ts'],
  ['jess', 'packages/syntax/jess/jess-parser/src/grammar.ts']
];

const results = [];
for (const [name, rel] of grammars) {
  const r = analyzeGrammar(rel);
  results.push([name, r]);
  console.log(`\n=== ${name} (${rel}) ===`);
  console.log(`  inline reducers analyzed:                ${r.totalReducers}`);
  console.log(`  reducers REJECTED:                       ${r.rejectedReducers}`);
  console.log(`    - STRUCTURAL (block/callback/etc):      ${r.structuralReducers}`);
  console.log(`    - binding-only (unresolved free names): ${r.bindingOnlyReducers}`);
  console.log(`  distinct free bindings referenced:       ${r.distinctFree}`);
  console.log(`  distinct UNRESOLVED free (would reject):  ${r.distinctUnresolved}`);
  console.log(`  distinct CARRIED (imported, resolvable): ${r.distinctCarried}`);
  console.log(`  structural reasons histogram:            ${JSON.stringify(r.structuralHist)}`);
  if (r.sampleStructural.length) {
    console.log(`  sample structural rejects: ${r.sampleStructural.join(' | ')}`);
  }
  console.log(`  unresolved free names (${r.topUnresolved.length}): ${r.topUnresolved.join(', ')}`);
}

console.log('\n\n--- RECONCILED TABLE @ 0.50.4 ---');
console.log('| grammar | inline reducers | reducers rejected | distinct free bindings | distinct unresolved (local helpers) | STRUCTURAL (block/callback) rejects | binding-only rejects |');
console.log('|---|---|---|---|---|---|---|');
for (const [name, r] of results) {
  console.log(`| ${name} | ${r.totalReducers} | ${r.rejectedReducers} | ${r.distinctFree} | ${r.distinctUnresolved} | ${r.structuralReducers} | ${r.bindingOnlyReducers} |`);
}

/*
 * `--check` turns the census into a gate: every grammar's inline reducers must
 * reference only IMPORTED helpers (0 module-scope local helpers). This is the exact
 * regression the B0 hoist removed, and it is a NECESSARY condition for cross-package
 * compose() fusion — but NOT sufficient: this is a static per-reducer analysis and
 * does NOT run the real `compose([cssBaseRules, delta])` (which additionally needs
 * parseman to macro-fuse the cross-package case — see docs/design/LESS-COMPOSE-REAUTHOR-PLAN.md
 * W0). The fix for any offender is to move the named helper into that dialect's
 * grammar-helpers.ts.
 */
if (process.argv.includes('--check')) {
  const offenders = results.filter(([, r]) => r.rejectedReducers > 0);
  if (offenders.length) {
    console.error('\n✗ reducer-purity gate FAILED — these grammars have reducers referencing module-scope local helpers:');
    for (const [name, r] of offenders) {
      console.error(`  ${name}: ${r.rejectedReducers} reducer(s); move these helpers into grammar-helpers.ts: ${r.topUnresolved.join(', ') || '(structural — see histogram above)'}`);
    }
    console.error('\nReducers must reference only imported helpers (see packages/syntax/*/src/grammar-helpers.ts). See docs/design/LESS-COMPOSE-REAUTHOR-PLAN.md.');
    process.exit(1);
  }
  console.log('\n✓ reducer-purity gate PASSED — all four grammars reference only imported helpers (0 module-scope local helpers).');
}
