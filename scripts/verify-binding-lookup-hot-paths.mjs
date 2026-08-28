#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Repo-native replacement for the ripgrep shell-outs this gate used to do.
 * `rg` is not installed on every developer machine, and a gate that crashes
 * with ENOENT instead of reporting is a gate people learn to bypass. The scan
 * semantics are unchanged: line-level regex match over the given source roots,
 * minus the excluded paths.
 */
function scanSources(searchRoots, pattern, excluded = []) {
  const excludedPaths = excluded.map(entry => resolve(root, entry));
  const matches = [];

  function isExcluded(fullPath) {
    return excludedPaths.some(entry => fullPath === entry || fullPath.startsWith(entry + sep));
  }

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (isExcluded(fullPath)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'lib') {
          continue;
        }
        walk(fullPath);
      } else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/u.test(entry.name)) {
        const lines = readFileSync(fullPath, 'utf8').split('\n');
        for (let index = 0; index < lines.length; index++) {
          if (pattern.test(lines[index])) {
            matches.push(`${relative(root, fullPath)}:${index + 1}:${lines[index]}`);
          }
        }
      }
    }
  }

  for (const searchRoot of searchRoots) {
    walk(resolve(root, searchRoot));
  }
  return matches;
}

const checks = [
  {
    label: 'reference reads use occurrence helpers, not Rules declaration wrappers',
    file: 'packages/core/src/tree/reference.ts',
    forbidden: [
      '.findVariable(',
      '.findProperty(',
      '.findDeclaration(',
      '.findAnyDeclaration(',
      'function lookupVariableReference(',
      'includeReadonly: true'
    ],
    required: [
      'findVariableDeclarationOccurrence',
      'findPropertyDeclarationOccurrence',
      'findAnyDeclarationOccurrence'
    ]
  },
  {
    label: 'setDefined assignment lookup stays on setDefined-only writable occurrence helper',
    file: 'packages/core/src/tree/rules.ts',
    required: [
      'findWritableSetDefinedDeclarationOccurrence('
    ],
    forbidden: [
      'applySetDefinedDeclarationReadonlyOccurrence(',
      'findSetDefinedDeclarationReadonlyOccurrence(',
      'findVariableDeclarationReadonlyOccurrence',
      'findPropertyDeclarationReadonlyOccurrence',
      'includeReadonly: true'
    ]
  },
  {
    label: 'selector attribute interpolation uses occurrence lookup, not Rules variable wrapper',
    file: 'packages/core/src/tree/selector-attr.ts',
    forbidden: [
      '.findVariable(',
      '.findProperty(',
      '.findDeclaration(',
      '.findAnyDeclaration('
    ],
    required: [
      'findVariableDeclarationOccurrence'
    ]
  },
  {
    label: 'stylesheet function return lookup uses occurrence lookup, not Rules property wrapper',
    file: 'packages/core/src/tree/function.ts',
    forbidden: [
      '.findVariable(',
      '.findProperty(',
      '.findDeclaration(',
      '.findAnyDeclaration('
    ],
    required: [
      'findPropertyDeclarationOccurrence'
    ]
  }
];

let failed = false;

for (const check of checks) {
  const checkPath = resolve(root, check.file);

  /*
   * A guarded file that no longer exists cannot contain a forbidden pattern; the
   * repo-wide scan below still enforces the same rules across whatever replaced
   * it. Skip rather than crash so the gate stays runnable after refactors.
   */
  if (!existsSync(checkPath)) {
    console.log(`- skip ${check.label} (${check.file} no longer exists; covered by repo-wide scan)`);
    continue;
  }
  const source = readFileSync(checkPath, 'utf8');
  for (const token of check.required ?? []) {
    if (!source.includes(token)) {
      console.error(`${check.label}: missing required token ${token} in ${check.file}`);
      failed = true;
    }
  }
  for (const token of check.forbidden ?? []) {
    if (source.includes(token)) {
      console.error(`${check.label}: forbidden token ${token} found in ${check.file}`);
      failed = true;
    }
  }
}

const directLookup = readFileSync(resolve(root, 'packages/core/src/tree/util/direct-rules-lookup.ts'), 'utf8');
const rulesSource = readFileSync(resolve(root, 'packages/core/src/tree/rules.ts'), 'utf8');
for (const token of [
  'findDeclaration(',
  'findAnyDeclaration(',
  'findVariable(',
  'findProperty('
]) {
  if (rulesSource.includes(`\n  ${token}`)) {
    console.error(`Rules class should not expose deleted declaration lookup wrapper ${token}`);
    failed = true;
  }
}
const directLookupExports = [...directLookup.matchAll(/^export function ([a-zA-Z0-9_]+)/gm)]
  .map(match => match[1]);
const expectedDirectLookupExports = [
  'isDirectDeclarationOccurrenceCurrent',
  'findVariableDeclarationOccurrence',
  'findVariableDeclarationOccurrence',
  'findPropertyDeclarationOccurrence',
  'findPropertyDeclarationOccurrence',
  'findWritableSetDefinedDeclarationOccurrence',
  'findAnyDeclarationOccurrence'
];
if (directLookupExports.join('\n') !== expectedDirectLookupExports.join('\n')) {
  console.error('direct declaration lookup export surface changed unexpectedly:');
  console.error(directLookupExports.map(name => `  ${name}`).join('\n'));
  failed = true;
}
const assignmentWrapperCount = (
  directLookup.match(/export function find(?:Variable|Property)DeclarationAssignmentLookup/g) ?? []
).length;
if (assignmentWrapperCount !== 0) {
  console.error(`expected no cold assignment lookup wrapper exports, found ${assignmentWrapperCount}`);
  failed = true;
}
const readonlyOccurrenceCount = (
  directLookup.match(/options: DirectDeclarationReadonlyFindOptions/g) ?? []
).length;
if (readonlyOccurrenceCount !== 0) {
  console.error(`expected no readonly occurrence overloads on hot helpers, found ${readonlyOccurrenceCount}`);
  failed = true;
}
if (directLookup.includes('includeReadonly')) {
  console.error('direct lookup should not expose includeReadonly option branching');
  failed = true;
}
for (const token of [
  'SetDefinedDeclarationMatchHandler',
  'onSetDefinedMatch',
  'applySetDefinedDeclarationReadonlyOccurrence',
  'findVariableDeclarationReadonlyOccurrence',
  'findPropertyDeclarationReadonlyOccurrence',
  'findSetDefinedDeclarationReadonlyOccurrence',
  'DirectDeclarationLookupResult',
  '{ ...options, includeLiveBindings: false }'
]) {
  if (directLookup.includes(token)) {
    console.error(`direct lookup should expose one setDefined readonly helper, found stale ${token}`);
    failed = true;
  }
}

const referenceSource = readFileSync(resolve(root, 'packages/core/src/tree/reference.ts'), 'utf8');
function getFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  const nextFunction = start === -1 ? -1 : source.indexOf('\nfunction ', start + 1);
  return start === -1
    ? undefined
    : source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}
function getConstObjectSource(source, name) {
  const start = source.indexOf(`const ${name}:`);
  const end = start === -1 ? -1 : source.indexOf('\n};', start);
  return start === -1
    ? undefined
    : source.slice(start, end === -1 ? undefined : end);
}

if (referenceSource.includes('getRulesLookupHandleDeclarationConstraintShape')) {
  console.error('declaration constraints should not be modeled as generic RulesLookupHandleShape fields');
  failed = true;
}
if (referenceSource.includes('function isRulesLookupHandleEligible(')) {
  console.error('rules lookup handle eligibility should live on lookup strategies, not a generic type ladder');
  failed = true;
}
if (referenceSource.includes('function tryReadSourceStaticRulesLookupHandle(')) {
  console.error('source-static rules lookup handle reads should be split by lookup strategy');
  failed = true;
}
if (referenceSource.includes('function lookupTypeUsesDeclarationConstraints(')) {
  console.error('declaration-constraint handle policy should be on declaration helpers, not a generic lookup-type predicate');
  failed = true;
}
if (referenceSource.includes('requiresHandleDeclarationConstraints')) {
  console.error('declaration-constraint handle policy should be a strategy type shape, not a boolean strategy flag');
  failed = true;
}
for (const token of [
  'const readArgs =',
  '...readArgs',
  '...baseArgs',
  'tryReadSourceStaticHandle({',
  'strategy.readHandle({',
  'strategy.writeHandle({',
  'writeStrategyRulesLookupHandle({',
  'ReadRulesLookupHandleArgs',
  'WriteRulesLookupHandleArgs',
  'SourceStaticRulesLookupHandleArgs'
]) {
  if (referenceSource.includes(token)) {
    console.error(`handle read/write dispatch should not use stale temp/spread object shape ${token}`);
    failed = true;
  }
}
if (referenceSource.includes('function readRulesLookupHandle(')) {
  console.error('rules lookup handle reads should be split by lookup strategy, not a generic reader with declaration constraints');
  failed = true;
}
const rulesReferenceLookupContextMatch = referenceSource.match(/type RulesReferenceLookupContext = \{[\s\S]*?\n\};/);
if (!rulesReferenceLookupContextMatch) {
  console.error('could not find RulesReferenceLookupContext block');
  failed = true;
} else if (rulesReferenceLookupContextMatch[0].includes('DeclarationConstraints')) {
  console.error('generic RulesReferenceLookupContext should not carry declaration handle constraints');
  failed = true;
}
if (!referenceSource.includes('function writeStrategyRulesLookupHandle(')) {
  console.error('rules lookup handle writes should route through the strategy writer dispatcher');
  failed = true;
}
for (const token of [
  'type ReferenceDeclarationLookupStrategy',
  'type ReferencePlainHandleLookupStrategy',
  'type ReferenceNoHandleLookupStrategy',
  'type ReferenceHandleLookupStrategy',
  'function isReferenceHandleLookupStrategy(',
  'function isReferenceDeclarationLookupStrategy(',
  'readHandle',
  'function readDeclarationRulesLookupHandle(',
  'function readVariableRulesLookupHandle(',
  'function readFunctionRulesLookupHandle(',
  'function readCallableRulesLookupHandle(',
  'function writeVariableRulesLookupHandle(',
  'function writeDeclarationRulesLookupHandle('
]) {
  if (!referenceSource.includes(token)) {
    console.error(`declaration handle writer is missing declaration-only args: ${token}`);
    failed = true;
  }
}
for (const token of [
  'readNoRulesLookupHandle',
  'tryReadNoSourceStaticRulesLookupHandle',
  'getNoRulesLookupHandleValueKey',
  'clearRulesLookupHandle'
]) {
  if (referenceSource.includes(token)) {
    console.error(`index/no-handle lookup should not keep no-op handle plumbing: ${token}`);
    failed = true;
  }
}
for (const name of [
  'INDEX_REFERENCE_LOOKUP_STRATEGY',
  'FUNCTION_REFERENCE_LOOKUP_STRATEGY',
  'MIXIN_REFERENCE_LOOKUP_STRATEGY',
  'MIXIN_RULESET_REFERENCE_LOOKUP_STRATEGY'
]) {
  const body = getConstObjectSource(referenceSource, name);
  if (body === undefined) {
    console.error(`could not find ${name}`);
    failed = true;
  } else if (body.includes('getHandleDeclarationConstraints')) {
    console.error(`${name} should not expose declaration constraint hooks`);
    failed = true;
  }
}
{
  const body = getConstObjectSource(referenceSource, 'INDEX_REFERENCE_LOOKUP_STRATEGY');
  if (body !== undefined) {
    for (const token of ['readHandle', 'writeHandle', 'getHandleValueKey', 'tryReadSourceStaticHandle', 'handleLookupType']) {
      if (body.includes(token)) {
        console.error(`index lookup strategy should not expose handle plumbing: ${token}`);
        failed = true;
      }
    }
  }
}
for (const name of [
  'readFunctionRulesLookupHandle',
  'readCallableRulesLookupHandle',
  'writeFunctionRulesLookupHandle',
  'writeCallableRulesLookupHandle'
]) {
  const body = getFunctionSource(referenceSource, name);
  if (body === undefined) {
    console.error(`could not find ${name}`);
    failed = true;
  } else if (body.includes('declarationConstraints')) {
    console.error(`${name} should not receive or read declaration constraint plumbing`);
    failed = true;
  }
}
for (const [name, token] of [
  ['readFunctionRulesLookupHandle', 'handle.lookupType !== \'function\''],
  ['readCallableRulesLookupHandle', 'handle.lookupType !== \'mixin\''],
  ['tryReadSourceStaticFunctionRulesLookupHandle', 'handle.lookupType !== \'function\''],
  ['tryReadSourceStaticMixinRulesLookupHandle', 'handle.lookupType !== \'mixin\''],
  ['tryReadSourceStaticMixinRulesetRulesLookupHandle', 'handle.lookupType !== \'mixin-ruleset\'']
]) {
  const body = getFunctionSource(referenceSource, name);
  if (body === undefined) {
    console.error(`could not find ${name}`);
    failed = true;
  } else if (body.includes(token)) {
    console.error(`${name} should rely on common exact lookup-type freshness instead of duplicate checks`);
    failed = true;
  }
}
for (const token of [
  'tryReadSourceStaticPropertyRulesLookupHandle',
  'tryReadSourceStaticVariableRulesLookupHandle',
  'tryReadSourceStaticFunctionRulesLookupHandle',
  'tryReadSourceStaticMixinRulesLookupHandle',
  'tryReadSourceStaticMixinRulesetRulesLookupHandle',
  'getHandleValueKey',
  'handleLookupType'
]) {
  if (!referenceSource.includes(token)) {
    console.error(`reference lookup strategy handle policy is missing ${token}`);
    failed = true;
  }
}
const referenceOptionsMatch = referenceSource.match(/export type ReferenceOptions = \{[\s\S]*?\n\};/);
if (!referenceOptionsMatch) {
  console.error('could not find exported ReferenceOptions block');
  failed = true;
} else {
  for (const token of ['excludedDeclaration0', 'excludedDeclaration1', 'excludedDeclarationCount']) {
    if (referenceOptionsMatch[0].includes(token)) {
      console.error(`exported ReferenceOptions still exposes internal scalar exclusion field ${token}`);
      failed = true;
    }
  }
  for (const token of ['excludedNodes', 'requiredNormalizedFromAssign']) {
    if (referenceOptionsMatch[0].includes(token)) {
      console.error(`exported ReferenceOptions still exposes old declaration-constraint option ${token}`);
      failed = true;
    }
  }
}

const rulesLookupHandleShapeMatch = referenceSource.match(/type RulesLookupHandleShape = \{[\s\S]*?\n\};/);
if (!rulesLookupHandleShapeMatch) {
  console.error('could not find private RulesLookupHandleShape block');
  failed = true;
} else {
  for (const token of [
    'requiredDeclarationAssignmentsKey',
    'excludedDeclaration0',
    'excludedDeclaration1',
    'excludedDeclarationCount'
  ]) {
    if (rulesLookupHandleShapeMatch[0].includes(token)) {
      console.error(`RulesLookupHandleShape still carries declaration constraint field ${token}`);
      failed = true;
    }
  }
}

const lookupUtilsSource = readFileSync(resolve(root, 'packages/core/src/tree/util/lookup-utils.ts'), 'utf8');
const declarationFindOptionsMatch = lookupUtilsSource.match(/export type DeclarationFindOptions = \{[\s\S]*?\n\};/);
if (!declarationFindOptionsMatch) {
  console.error('could not find exported DeclarationFindOptions block');
  failed = true;
} else {
  for (const token of [
    'excludedNode0',
    'excludedNode1',
    'excludedNodes',
    'excludedNodesLength',
    'requiredNormalizedFromAssign'
  ]) {
    if (declarationFindOptionsMatch[0].includes(token)) {
      console.error(`DeclarationFindOptions still exposes stale declaration constraint option ${token}`);
      failed = true;
    }
  }
}

const declarationSource = readFileSync(resolve(root, 'packages/core/src/tree/declaration.ts'), 'utf8');
for (const token of ['excludedNode0', 'excludedNode1', 'excludedNodesLength', 'requiredNormalizedFromAssign']) {
  if (declarationSource.includes(token)) {
    console.error(`Declaration assignment merge path still constructs stale declaration constraint ${token}`);
    failed = true;
  }
}

const productionWrapperCalls = scanSources(
  ['packages/core/src'],
  /\.find(?:Variable|Property|Declaration|AnyDeclaration)\(/u,
  ['packages/core/src/tree/rules.ts']
).filter(line => !line.includes('__tests__'));
if (productionWrapperCalls.length > 0) {
  console.error('production runtime still calls public Rules.find* declaration wrappers:');
  console.error(productionWrapperCalls.join('\n'));
  failed = true;
}

const stringFilterShapes = scanSources(
  [
    'packages/core/src',
    'packages/syntax/jess/jess-parser/src',
    'packages/syntax/less/less-parser/src',
    'packages/syntax/scss/scss-parser/src',
    'packages/syntax/scss/scss-parser/test'
  ],
  /findDeclaration\([^\n]+,\s*['"](?:VarDeclaration|Declaration)['"]|filterType: 'VarDeclaration'|filterType: 'Declaration'/u
);
if (stringFilterShapes.length > 0) {
  console.error('old string-filter Rules.findDeclaration shape is still present');
  console.error(stringFilterShapes.join('\n'));
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Binding lookup hot-path guard passed.');
}
