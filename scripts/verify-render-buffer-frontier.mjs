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
const internalHelperExportPattern = /^export function (?:renderInvisibleEffect|writeRenderedOutput|writeRootAwareOutput)\b/u;
const allowedFiles = new Set([
  'packages/core/src/tree/util/render-buffer.ts'
]);
const expectedControlIterationRenderFile = 'packages/core/src/tree/control.ts';

/*
 * NAMED sites, not a count. `=== 2` was satisfied by deleting one legitimate
 * site and adding an illegitimate one in the same file. Each entry names the
 * loop construct that owns the site and pins the enclosing class it must sit
 * in, so the failure says WHICH site appeared or vanished.
 */
const expectedControlIterationRenderNamedSites = [
  { name: 'For: per-iteration surface render', owner: 'export class For extends Rules' },
  { name: 'While: per-iteration surface render', owner: 'export class While extends Rules' }
];

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
  console.log('Production render paths should call node render methods directly; keep renderNodeTo* helpers in tests/util only.');
  process.exitCode = 1;
}

if (selectedOutputMatches.length > 0) {
  console.log('');
  console.log('Node render overloads should route local eval/resolve output through renderSourceOutput; do not reintroduce selected-output helper surfaces.');
  process.exitCode = 1;
}

if (internalHelperExportMatches.length > 0) {
  console.log('');
  console.log('Low-level render-buffer helpers should stay internal; node code should use the narrow public render helper surface.');
  process.exitCode = 1;
}

const unexpectedControlIterationRenderSites = controlIterationRenderMatches
  .filter(match => match.file !== expectedControlIterationRenderFile);

/*
 * Resolve each match to the class that encloses it, so a site can be checked by
 * NAME rather than merely counted.
 */
const controlSourceLines = fs.existsSync(path.join(rootDir, expectedControlIterationRenderFile))
  ? fs.readFileSync(path.join(rootDir, expectedControlIterationRenderFile), 'utf8').split(/\r?\n/u)
  : [];
const ownerOf = (lineNumber) => {
  for (let index = lineNumber - 1; index >= 0; index--) {
    const owner = expectedControlIterationRenderNamedSites
      .find(site => controlSourceLines[index]?.startsWith(site.owner));
    if (owner) {
      return owner.name;
    }
  }
  return null;
};
const observedNamedSites = new Set(controlIterationRenderMatches
  .filter(match => match.file === expectedControlIterationRenderFile)
  .map(match => ownerOf(match.line)));
const missingNamedSites = expectedControlIterationRenderNamedSites
  .filter(site => !observedNamedSites.has(site.name))
  .map(site => site.name);
const unownedNamedSites = observedNamedSites.has(null) ? ['<render site in no recorded loop class>'] : [];

if (
  unexpectedControlIterationRenderSites.length > 0
  || missingNamedSites.length > 0
  || unownedNamedSites.length > 0
) {
  console.log('');
  console.log('Control loop render should stream each iteration through direct Rules.render calls; update this verifier when that native path changes.');
  if (unexpectedControlIterationRenderSites.length > 0) {
    console.log('Unexpected control iteration render sites:');
    for (const match of unexpectedControlIterationRenderSites) {
      console.log(`- ${match.file}`);
      console.log(`  ${match.line}: ${match.text}`);
    }
  }
  if (missingNamedSites.length > 0) {
    console.log(`Missing control iteration render site(s) in ${expectedControlIterationRenderFile}:`);
    for (const name of missingNamedSites) {
      console.log(`- ${name}`);
    }
  }
  if (unownedNamedSites.length > 0) {
    console.log(`Unrecorded control iteration render site(s) in ${expectedControlIterationRenderFile}:`);
    for (const name of unownedNamedSites) {
      console.log(`- ${name}`);
    }
  }
  process.exitCode = 1;
}
