#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const scanRoots = [
  path.join(rootDir, 'packages/core/src/tree'),
  path.join(rootDir, 'packages/jess/src')
];
const ignoredSegments = new Set([
  '__tests__'
]);

const frontierPattern = /\b(?:resolved|evald|evaluated)\.toTrimmedString\(\s*prepared\s*\)/u;
const expectedRemaining = new Map();

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
for (const scanRoot of scanRoots) {
  if (!fs.existsSync(scanRoot)) {
    continue;
  }
  for (const file of walk(scanRoot)) {
    const relative = path.relative(rootDir, file);
    const source = fs.readFileSync(file, 'utf8');
    source.split(/\r?\n/u).forEach((line, index) => {
      if (frontierPattern.test(line)) {
        matches.push({ file: relative, line: index + 1, text: line.trim() });
      }
    });
  }
}

const files = [...new Set(matches.map(match => match.file))].sort();
const unexpected = matches.filter(match => !expectedRemaining.has(match.file));
const missingExpected = [...expectedRemaining.keys()].filter(file => !files.includes(file));

console.log('Materialization frontier scan');
console.log('');
if (expectedRemaining.size === 0) {
  console.log('Expected remaining resolve/eval-then-serialize seams: none');
} else {
  console.log('Expected remaining resolve/eval-then-serialize seams:');
  for (const [file, reason] of expectedRemaining) {
    console.log(`- ${file}: ${reason}`);
    for (const match of matches.filter(match => match.file === file)) {
      console.log(`  ${match.line}: ${match.text}`);
    }
  }
}

if (unexpected.length > 0) {
  console.log('');
  console.log('Unexpected resolve/eval-then-serialize materialization sites:');
  for (const match of unexpected) {
    console.log(`- ${match.file}`);
    console.log(`  ${match.line}: ${match.text}`);
  }
  process.exitCode = 1;
}

if (missingExpected.length > 0) {
  console.log('');
  console.log('Expected materialization frontier entries with no remaining matches:');
  for (const file of missingExpected) {
    console.log(`- ${file}`);
  }
  console.log('');
  console.log('Remove the cleared file from scripts/verify-materialization-frontier.mjs.');
  process.exitCode = 1;
}
