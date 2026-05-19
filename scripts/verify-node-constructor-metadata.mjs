#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const treeDir = path.join(rootDir, 'packages/core/src/tree');
const constructorAnyPattern = /constructor\([^)]*\b(?:options|location|treeContext)\?:\s*any\b/;

function* sourceFiles(dir) {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (dirent.name === '__tests__') {
        continue;
      }
      yield* sourceFiles(filePath);
      continue;
    }
    if (dirent.isFile() && dirent.name.endsWith('.ts')) {
      yield filePath;
    }
  }
}

const failures = [];
for (const filePath of sourceFiles(treeDir)) {
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (constructorAnyPattern.test(lines[index])) {
      failures.push({
        filePath: path.relative(rootDir, filePath),
        line: index + 1,
        text: lines[index].trim()
      });
    }
  }
}

if (failures.length > 0) {
  console.error('Node constructor metadata check failed:');
  for (const failure of failures) {
    console.error(`- ${failure.filePath}:${failure.line}: ${failure.text}`);
  }
  process.exit(1);
}

console.log('Node constructor metadata check passed.');
