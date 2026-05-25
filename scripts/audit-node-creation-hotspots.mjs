#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const treeDir = path.join(rootDir, 'packages/core/src/tree');
const ignoredSegments = new Set(['__tests__', 'util']);

const patterns = [
  { name: 'new-node', pattern: /\bnew\s+(?:[A-Z][A-Za-z0-9_]*)\b/u },
  { name: 'derive', pattern: /\bderive[A-Z]\w*\(|\.derive\(/u },
  { name: 'with-surface', pattern: /\bwith[A-Z]\w*\(/u },
  { name: 'copy-leaves', pattern: /\bcopyWithReusableLeaves\(/u },
  { name: 'clone-leaves', pattern: /\bcloneChildrenWithReusableLeaves\(/u },
  { name: 'container-output', pattern: /\brenderRulesContainerOutput\(/u },
  { name: 'resolved-output', pattern: /\brenderResolvedOutput\(/u },
  { name: 'source-output', pattern: /\brenderSourceOutput\(/u }
];

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredSegments.has(entry.name)) {
        files.push(...walk(fullPath));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function methodContext(line) {
  if (/\boverride render\(/u.test(line)) {
    return 'render';
  }
  if (/\bevalNode\(/u.test(line)) {
    return 'evalNode';
  }
  if (/\boverride resolve\(/u.test(line)) {
    return 'resolve';
  }
  if (/\bprepareRegistration\(/u.test(line)) {
    return 'prepareRegistration';
  }
  return undefined;
}

const matches = [];
for (const file of walk(treeDir)) {
  const relative = path.relative(rootDir, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
  let currentMethod = 'module';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentMethod = methodContext(line) ?? currentMethod;
    for (const { name, pattern } of patterns) {
      if (pattern.test(line)) {
        matches.push({
          file: relative,
          line: i + 1,
          kind: name,
          method: currentMethod,
          text: line.trim()
        });
      }
    }
  }
}

const byFile = new Map();
const byKind = new Map();
const byMethod = new Map();
for (const match of matches) {
  byFile.set(match.file, (byFile.get(match.file) ?? 0) + 1);
  byKind.set(match.kind, (byKind.get(match.kind) ?? 0) + 1);
  byMethod.set(match.method, (byMethod.get(match.method) ?? 0) + 1);
}

function ranked(map, limit = 12) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

console.log('Node creation hotspot audit');
console.log('');
console.log('By file:');
for (const [file, count] of ranked(byFile)) {
  console.log(`- ${file}: ${count}`);
}
console.log('');
console.log('By kind:');
for (const [kind, count] of ranked(byKind)) {
  console.log(`- ${kind}: ${count}`);
}
console.log('');
console.log('By method context:');
for (const [method, count] of ranked(byMethod)) {
  console.log(`- ${method}: ${count}`);
}
console.log('');
console.log('Top render/eval/resolve surface lines:');
for (const match of matches
  .filter(match => match.method !== 'module')
  .slice(0, 80)) {
  console.log(`- ${match.file}:${match.line} [${match.method}/${match.kind}] ${match.text}`);
}
