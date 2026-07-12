#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

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
    label: 'setDefined assignment lookup stays on setDefined-only apply helper',
    file: 'packages/core/src/tree/rules.ts',
    required: [
      'applySetDefinedDeclarationReadonlyOccurrence('
    ],
    forbidden: [
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
  const source = readFileSync(resolve(root, check.file), 'utf8');
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
  'applySetDefinedDeclarationReadonlyOccurrence',
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
  'findVariableDeclarationReadonlyOccurrence',
  'findPropertyDeclarationReadonlyOccurrence',
  'findSetDefinedDeclarationReadonlyOccurrence',
  'DirectDeclarationLookupResult'
]) {
  if (directLookup.includes(token)) {
    console.error(`direct lookup should expose one setDefined readonly helper, found stale ${token}`);
    failed = true;
  }
}

const referenceSource = readFileSync(resolve(root, 'packages/core/src/tree/reference.ts'), 'utf8');
const referenceOptionsMatch = referenceSource.match(/export type ReferenceOptions = \{[\s\S]*?\n\};/);
if (!referenceOptionsMatch) {
  console.error('could not find exported ReferenceOptions block');
  failed = true;
} else {
  for (const token of ['excludedNode0', 'excludedNode1', 'excludedNodesLength']) {
    if (referenceOptionsMatch[0].includes(token)) {
      console.error(`exported ReferenceOptions still exposes internal scalar exclusion field ${token}`);
      failed = true;
    }
  }
}

try {
  const productionWrapperCalls = execFileSync('rg', [
    '-n',
    String.raw`\.find(?:Variable|Property|Declaration|AnyDeclaration)\(`,
    'packages/core/src',
    '--glob',
    '!packages/core/src/tree/rules.ts',
    '--glob',
    '!**/__tests__/**'
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  console.error('production runtime still calls public Rules.find* declaration wrappers:');
  console.error(productionWrapperCalls.trimEnd());
  failed = true;
} catch (error) {
  if (error.status !== 1) {
    throw error;
  }
}

try {
  execFileSync('rg', [
    '-n',
    String.raw`findDeclaration\([^\n]+,\s*['"](VarDeclaration|Declaration)['"]|filterType: 'VarDeclaration'|filterType: 'Declaration'`,
    'packages/core/src',
    'packages/core/src/tree/__tests__',
    'packages/jess-parser/src',
    'packages/less-parser/src',
    'packages/scss-parser/src',
    'packages/scss-parser/test'
  ], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  console.error('old string-filter Rules.findDeclaration shape is still present');
  failed = true;
} catch (error) {
  if (error.status !== 1) {
    throw error;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Binding lookup hot-path guard passed.');
}
