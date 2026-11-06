#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
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
const ordinaryCopyPattern = /\.copy\(/u;
const ordinaryClonePattern = /\.clone\(/u;
const loopEvalSurfaceCopyPattern = /return copyWithReusableLeaves\(node\);/u;
const guardEvalCopyPattern = /\bcopyGuardForEval\b/u;
const allowedOrdinaryClonePatterns = [
  {
    /*
     * Not a jess tree node. plugin-runtime.ts is the sandboxed Deno script
     * runtime for Less 4.x `@plugin` compatibility; it declares its OWN local `Unit` class
     * mirroring less.js, and `unitOf` clones that value object. The copy
     * frontier invariant is about the core evaluation spine (V8-ARCHITECTURE
     * §5), which this runtime is not part of.
     */
    file: 'packages/jess-plugin-js/src/plugin-runtime.ts',
    pattern: /\breturn unit\.clone\(\);/u
  }
];
const expectedRemaining = new Set();

function getScanRoots() {
  if (!fs.existsSync(packagesDir)) {
    return [];
  }
  return fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(packagesDir, dirent.name, 'src'))
    .filter(sourceDir => fs.existsSync(sourceDir));
}

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

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('*')
    || trimmed.startsWith('//')
    || trimmed.startsWith('/*');
}

function isAllowedOrdinaryCloneLine(relativeFile, line) {
  return allowedOrdinaryClonePatterns.some(allowed => (
    allowed.file === relativeFile && allowed.pattern.test(line)
  ));
}

const matches = [];
const ordinaryCopyMatches = [];
const ordinaryCloneMatches = [];
const loopEvalSurfaceCopyMatches = [];
const guardEvalCopyMatches = [];
for (const scanRoot of getScanRoots()) {
  if (!fs.existsSync(scanRoot)) {
    continue;
  }
  for (const file of walk(scanRoot)) {
    const relative = path.relative(rootDir, file);
    const source = fs.readFileSync(file, 'utf8');
    source.split(/\r?\n/u).forEach((line, index) => {
      if (patterns.some(pattern => pattern.test(line))) {
        matches.push({ file: relative, line: index + 1, text: line.trim() });
      }
      if (ordinaryCopyPattern.test(line)) {
        ordinaryCopyMatches.push({ file: relative, line: index + 1, text: line.trim() });
      }
      if (ordinaryClonePattern.test(line) && !isCommentLine(line)) {
        ordinaryCloneMatches.push({ file: relative, line: index + 1, text: line.trim() });
      }
      if (loopEvalSurfaceCopyPattern.test(line)) {
        loopEvalSurfaceCopyMatches.push({ file: relative, line: index + 1, text: line.trim() });
      }
      if (guardEvalCopyPattern.test(line)) {
        guardEvalCopyMatches.push({ file: relative, line: index + 1, text: line.trim() });
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
const frontierFiles = files;
const unexpected = frontierFiles.filter(file => !expectedRemaining.has(file));
const missingExpected = [...expectedRemaining].filter(file => !frontierFiles.includes(file));
const unexpectedOrdinaryCopy = ordinaryCopyMatches;
const unexpectedOrdinaryClone = ordinaryCloneMatches
  .filter(match => !isAllowedOrdinaryCloneLine(match.file, match.text));
const unexpectedLoopEvalSurfaceCopies = loopEvalSurfaceCopyMatches;
const unexpectedGuardEvalCopies = guardEvalCopyMatches;

console.log('Node copy frontier scan');
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

if (unexpectedLoopEvalSurfaceCopies.length > 0) {
  console.log('');
  console.log('Unexpected loop eval-surface child-copy seams:');
  for (const match of unexpectedLoopEvalSurfaceCopies) {
    console.log(`- ${match.file}`);
    console.log(`  ${match.line}: ${match.text}`);
  }
  process.exitCode = 1;
}

if (unexpectedGuardEvalCopies.length > 0) {
  console.log('');
  console.log('Unexpected callable guard eval copy hooks:');
  for (const match of unexpectedGuardEvalCopies) {
    console.log(`- ${match.file}`);
    console.log(`  ${match.line}: ${match.text}`);
  }
  process.exitCode = 1;
}

if (unexpectedOrdinaryCopy.length > 0) {
  console.log('');
  console.log('Unexpected ordinary production .copy() sites:');
  for (const match of unexpectedOrdinaryCopy) {
    console.log(`- ${match.file}`);
    console.log(`  ${match.line}: ${match.text}`);
  }
  process.exitCode = 1;
}

if (unexpectedOrdinaryClone.length > 0) {
  console.log('');
  console.log('Unexpected ordinary production .clone() sites:');
  for (const match of unexpectedOrdinaryClone) {
    console.log(`- ${match.file}`);
    console.log(`  ${match.line}: ${match.text}`);
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
