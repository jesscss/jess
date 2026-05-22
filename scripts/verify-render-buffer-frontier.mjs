#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const ignoredSegments = new Set([
  '__tests__'
]);
const frontierPattern = /\brenderNodeTo(?:Buffer|Writer|String)\b/u;
const evalOutputPattern = /\brenderEvalOutput\s*\(/u;
const selectedOutputPattern = /\b(?:renderSelectedOutput|writeSelectedOutput)\b/u;
const controlIterationRenderPattern = /iterationRules\.render\(\s*context,\s*buffer/u;
const internalHelperExportPattern = /^export function (?:renderNoOutput|writeNoOutput|writeRenderedOutput|writeRootAwareOutput)\b/u;
const allowedFiles = new Set([
  'packages/core/src/tree/util/render-buffer.ts'
]);
const expectedControlIterationRenderFile = 'packages/core/src/tree/control.ts';
const expectedControlIterationRenderSites = 1;

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
    if (entry.isFile() && /\.ts$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const matches = [];
const evalOutputMatches = [];
const selectedOutputMatches = [];
const controlIterationRenderMatches = [];
const internalHelperExportMatches = [];
for (const scanRoot of getScanRoots()) {
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
      if (
        evalOutputPattern.test(line)
        && !allowedFiles.has(relative)
      ) {
        evalOutputMatches.push({ file: relative, line: index + 1, text: line.trim() });
      }
      if (
        selectedOutputPattern.test(line)
        && !allowedFiles.has(relative)
      ) {
        selectedOutputMatches.push({ file: relative, line: index + 1, text: line.trim() });
      }
      if (controlIterationRenderPattern.test(line)) {
        controlIterationRenderMatches.push({ file: relative, line: index + 1, text: line.trim() });
      }
      if (internalHelperExportPattern.test(line)) {
        internalHelperExportMatches.push({ file: relative, line: index + 1, text: line.trim() });
      }
    });
  }
}

console.log('Render buffer frontier scan');
console.log('');
console.log('Production renderNodeTo helper sites:');
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
console.log('');
console.log('Eval-output helper sites:');
if (evalOutputMatches.length === 0) {
  console.log('- none');
}
for (const file of [...new Set(evalOutputMatches.map(match => match.file))].sort()) {
  console.log(`- ${file}`);
  for (const match of evalOutputMatches.filter(match => match.file === file)) {
    console.log(`  ${match.line}: ${match.text}`);
  }
}
console.log('');
console.log('Stale selected-output helper sites:');
if (selectedOutputMatches.length === 0) {
  console.log('- none');
}
for (const file of [...new Set(selectedOutputMatches.map(match => match.file))].sort()) {
  console.log(`- ${file}`);
  for (const match of selectedOutputMatches.filter(match => match.file === file)) {
    console.log(`  ${match.line}: ${match.text}`);
  }
}
console.log('');
console.log('Control native iteration render sites:');
if (controlIterationRenderMatches.length === 0) {
  console.log('- none');
}
for (const match of controlIterationRenderMatches) {
  console.log(`- ${match.file}`);
  console.log(`  ${match.line}: ${match.text}`);
}
console.log('');
console.log('Internal render helper exports:');
if (internalHelperExportMatches.length === 0) {
  console.log('- none');
}
for (const match of internalHelperExportMatches) {
  console.log(`- ${match.file}`);
  console.log(`  ${match.line}: ${match.text}`);
}

if (matches.length > 0) {
  console.log('');
  console.log(
    'Production render paths should call node render methods directly; keep renderNodeTo* helpers in tests/util only.'
  );
  process.exitCode = 1;
}

if (selectedOutputMatches.length > 0) {
  console.log('');
  console.log(
    'Node render overloads should route evaluated output through renderEvalOutput; do not reintroduce selected-output helper surfaces.'
  );
  process.exitCode = 1;
}

if (internalHelperExportMatches.length > 0) {
  console.log('');
  console.log(
    'Low-level render-buffer helpers should stay internal; node code should use the narrow public render helper surface.'
  );
  process.exitCode = 1;
}

const unexpectedControlIterationRenderSites = controlIterationRenderMatches
  .filter(match => match.file !== expectedControlIterationRenderFile);
const expectedFileControlIterationRenderCount = controlIterationRenderMatches
  .filter(match => match.file === expectedControlIterationRenderFile)
  .length;

if (
  unexpectedControlIterationRenderSites.length > 0
  || expectedFileControlIterationRenderCount !== expectedControlIterationRenderSites
) {
  console.log('');
  console.log(
    'Control loop render should stream each iteration through node render methods; update this verifier when that native path changes.'
  );
  if (unexpectedControlIterationRenderSites.length > 0) {
    console.log('Unexpected control iteration render sites:');
    for (const match of unexpectedControlIterationRenderSites) {
      console.log(`- ${match.file}`);
      console.log(`  ${match.line}: ${match.text}`);
    }
  }
  if (expectedFileControlIterationRenderCount !== expectedControlIterationRenderSites) {
    console.log(
      `Expected ${expectedControlIterationRenderSites} control iteration render site(s) in ${expectedControlIterationRenderFile}, found ${expectedFileControlIterationRenderCount}.`
    );
  }
  process.exitCode = 1;
}
