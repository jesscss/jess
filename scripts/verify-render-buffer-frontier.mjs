#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const scanRoot = path.join(rootDir, 'packages/core/src/tree');
const ignoredSegments = new Set([
  '__tests__',
  'util'
]);
const frontierPattern = /renderNodeToBuffer\(\s*this\s*,/u;
const expectedRemaining = new Set([
  'packages/core/src/tree/at-rule.ts',
  'packages/core/src/tree/block.ts',
  'packages/core/src/tree/call.ts',
  'packages/core/src/tree/control.ts',
  'packages/core/src/tree/declaration.ts',
  'packages/core/src/tree/import-style.ts',
  'packages/core/src/tree/interpolated.ts',
  'packages/core/src/tree/js-expr.ts',
  'packages/core/src/tree/list.ts',
  'packages/core/src/tree/quoted.ts',
  'packages/core/src/tree/reference.ts',
  'packages/core/src/tree/rules.ts',
  'packages/core/src/tree/ruleset.ts',
  'packages/core/src/tree/selector-capture.ts',
  'packages/core/src/tree/selector-interpolated.ts',
  'packages/core/src/tree/selector.ts',
  'packages/core/src/tree/sequence.ts',
  'packages/core/src/tree/url.ts'
]);

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
    if (entry.isFile() && /\.ts$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const matches = [];
for (const file of walk(scanRoot)) {
  const relative = path.relative(rootDir, file);
  const source = fs.readFileSync(file, 'utf8');
  source.split(/\r?\n/u).forEach((line, index) => {
    if (frontierPattern.test(line)) {
      matches.push({ file: relative, line: index + 1, text: line.trim() });
    }
  });
}

const files = [...new Set(matches.map(match => match.file))].sort();
const unexpected = files.filter(file => !expectedRemaining.has(file));
const missingExpected = [...expectedRemaining].filter(file => !files.includes(file));

console.log('Render buffer frontier scan');
console.log('');
console.log('Expected remaining wrapper bridges:');
for (const file of files.filter(file => expectedRemaining.has(file))) {
  console.log(`- ${file}`);
  for (const match of matches.filter(match => match.file === file)) {
    console.log(`  ${match.line}: ${match.text}`);
  }
}

if (unexpected.length > 0) {
  console.log('');
  console.log('Unexpected renderNodeToBuffer(this, ...) sites:');
  for (const file of unexpected) {
    console.log(`- ${file}`);
    for (const match of matches.filter(match => match.file === file)) {
      console.log(`  ${match.line}: ${match.text}`);
    }
  }
  process.exitCode = 1;
}

if (missingExpected.length > 0) {
  console.log('');
  console.log('Expected frontier entries with no remaining wrapper bridge:');
  for (const file of missingExpected) {
    console.log(`- ${file}`);
  }
  process.exitCode = 1;
}
