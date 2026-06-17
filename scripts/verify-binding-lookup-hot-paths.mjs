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
      'findVariableDeclarationAssignmentLookup',
      'findPropertyDeclarationAssignmentLookup'
    ],
    required: [
      'findVariableDeclarationOccurrence',
      'findPropertyDeclarationOccurrence',
      'findAnyDeclarationOccurrence'
    ]
  },
  {
    label: 'assignment lookup wrappers stay isolated to setDefined registration',
    file: 'packages/core/src/tree/rules.ts',
    required: [
      'findVariableDeclarationAssignmentLookup',
      'findPropertyDeclarationAssignmentLookup'
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
const assignmentWrapperCount = (
  directLookup.match(/export function find(?:Variable|Property)DeclarationAssignmentLookup/g) ?? []
).length;
if (assignmentWrapperCount !== 2) {
  console.error(`expected exactly 2 cold assignment lookup wrappers, found ${assignmentWrapperCount}`);
  failed = true;
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
  execFileSync('rg', [
    '-n',
    String.raw`findDeclaration\([^\n]+,\s*['"](VarDeclaration|Declaration)['"]|filterType: 'VarDeclaration'|filterType: 'Declaration'`,
    'packages/core/src',
    'packages/core/src/tree/__tests__',
    'packages/jess-parser/src',
    'packages/less-parser/src',
    'packages/scss-parser/src'
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
