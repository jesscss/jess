#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const scanRoots = [
  'packages/core/src',
  'packages/jess/src',
  'packages/less-parser/src',
  'packages/scss-parser/src'
];
const ignoredSegments = new Set([
  '__tests__',
  'lib'
]);
const patterns = [
  /\.copy\(\s*true/u,
  /\.clone\(\s*true/u,
  /copyWithReusableLeaves\(\s*this\s*\)/u,
  /cloneWithReusableLeaves\(/u
];
const infrastructureFiles = new Set([
  'packages/core/src/tree/util/cloning.ts'
]);
const expectedRemaining = new Set();

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredSegments.has(entry.name)) {
        files.push(...walk(fullPath));
      }
      continue;
    }
    if (entry.isFile() && /\.(?:ts|js|mjs)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const matches = [];
for (const scanRoot of scanRoots) {
  const absoluteRoot = path.join(rootDir, scanRoot);
  if (!fs.existsSync(absoluteRoot)) {
    continue;
  }
  for (const file of walk(absoluteRoot)) {
    const relative = path.relative(rootDir, file);
    const source = fs.readFileSync(file, 'utf8');
    source.split(/\r?\n/u).forEach((line, index) => {
      if (patterns.some(pattern => pattern.test(line))) {
        matches.push({ file: relative, line: index + 1, text: line.trim() });
      }
    });
  }
}

const byFile = new Map();
for (const match of matches) {
  const list = byFile.get(match.file) ?? [];
  list.push(match);
  byFile.set(match.file, list);
}

const files = [...byFile.keys()].sort();
const frontierFiles = files.filter(file => !infrastructureFiles.has(file));
const unexpected = frontierFiles.filter(file => !expectedRemaining.has(file));
const missingExpected = [...expectedRemaining].filter(file => !frontierFiles.includes(file));

console.log('Node copy frontier scan');
console.log('');
console.log('Infrastructure:');
for (const file of files.filter(file => infrastructureFiles.has(file))) {
  console.log(`- ${file}`);
}
console.log('');
console.log('Expected remaining frontier:');
for (const file of frontierFiles.filter(file => expectedRemaining.has(file))) {
  console.log(`- ${file}`);
  for (const match of byFile.get(file) ?? []) {
    console.log(`  ${match.line}: ${match.text}`);
  }
}

if (unexpected.length > 0) {
  console.log('');
  console.log('Unexpected copy/clone sites:');
  for (const file of unexpected) {
    console.log(`- ${file}`);
    for (const match of byFile.get(file) ?? []) {
      console.log(`  ${match.line}: ${match.text}`);
    }
  }
  process.exitCode = 1;
}

if (missingExpected.length > 0) {
  console.log('');
  console.log('Expected frontier entries with no remaining matches:');
  for (const file of missingExpected) {
    console.log(`- ${file}`);
  }
  process.exitCode = 1;
}
