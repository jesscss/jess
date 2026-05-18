#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const scanRoots = [
  path.join(rootDir, 'packages/core/src/tree'),
  path.join(rootDir, 'packages/jess/src')
];
const ignoredSegments = new Set([
  '__tests__',
  'util'
]);
const frontierPattern = /\brenderNodeTo(?:Buffer|Writer|String)\b/u;
const allowedFiles = new Set([
  'packages/core/src/tree/util/render-buffer.ts'
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
for (const scanRoot of scanRoots) {
  if (!fs.existsSync(scanRoot)) {
    continue;
  }
  for (const file of walk(scanRoot)) {
    const relative = path.relative(rootDir, file);
    if (allowedFiles.has(relative)) {
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    source.split(/\r?\n/u).forEach((line, index) => {
      if (frontierPattern.test(line)) {
        matches.push({ file: relative, line: index + 1, text: line.trim() });
      }
    });
  }
}

console.log('Render buffer frontier scan');
console.log('');
console.log('Production render bridge helper sites:');
if (matches.length === 0) {
  console.log('- none');
}

const files = [...new Set(matches.map(match => match.file))].sort();
for (const file of files) {
  console.log(`- ${file}`);
  for (const match of matches.filter(match => match.file === file)) {
    console.log(`  ${match.line}: ${match.text}`);
  }
}

if (matches.length > 0) {
  console.log('');
  console.log(
    'Production render paths should call node render methods directly; keep renderNodeTo* helpers in tests/util only.'
  );
  process.exitCode = 1;
}
