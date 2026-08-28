#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const orderedConditions = ['types', 'source', 'import', 'require'];
const rootRenderBufferExportPattern = /export\s+(?<exports>\*|\{[^}]*\})\s+from\s+['"]\.\/tree\/util\/render-buffer\.js['"]/gu;
const allowedRootRenderBufferExports = new Set([
  'createRenderBuffer',
  'finalizeFlatRenderBuffer',
  'FlatRenderBuffer',
  'RenderBuffer'
]);
const retiredCoreRootExports = ['DocumentContext', 'DocumentContextOptions'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function checkExportConditions(packageName, exportPath, value, failures) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const keys = Object.keys(value);
  let previousIndex = -1;
  for (const condition of orderedConditions) {
    const index = keys.indexOf(condition);
    if (index === -1) {
      continue;
    }
    if (index < previousIndex) {
      failures.push(`${packageName} ${exportPath}: ${condition} appears before an earlier export condition`);
      return;
    }
    previousIndex = index;
  }
}

const failures = [];
const coreIndexPath = path.join(rootDir, 'packages/core/src/index.ts');
if (fs.existsSync(coreIndexPath)) {
  const coreIndexSource = fs.readFileSync(coreIndexPath, 'utf8');
  for (const name of retiredCoreRootExports) {
    if (new RegExp(`\\b${name}\\b`, 'u').test(coreIndexSource)) {
      failures.push(`@jesscss/core root export: retired ${name} is still present in src/index.ts`);
    }
  }
  for (const match of coreIndexSource.matchAll(rootRenderBufferExportPattern)) {
    const exported = match.groups?.exports;
    if (!exported || exported === '*') {
      failures.push('@jesscss/core root export: render-buffer must use a narrow named export list');
      continue;
    }
    const names = exported
      .slice(1, -1)
      .split(',')
      .map(part => part.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0]?.trim())
      .filter(part => part !== undefined && part !== '');

    for (const name of names) {
      if (!allowedRootRenderBufferExports.has(name)) {
        failures.push(`@jesscss/core root export: ${name} is not an allowed render-buffer root export`);
      }
    }
  }
}

const coreEsmPath = path.join(rootDir, 'packages/core/lib/index.js');
const coreCjsPath = path.join(rootDir, 'packages/core/lib/index.cjs');
if (fs.existsSync(coreEsmPath) && fs.existsSync(coreCjsPath)) {
  const cacheKey = `package-export-check=${fs.statSync(coreEsmPath).mtimeMs}`;
  const esm = await import(`${pathToFileURL(coreEsmPath).href}?${cacheKey}`);
  const cjs = createRequire(import.meta.url)(coreCjsPath);
  for (const name of retiredCoreRootExports) {
    if (Object.hasOwn(esm, name) || Object.hasOwn(cjs, name)) {
      failures.push(`@jesscss/core built root export: retired ${name} remains in ESM or CJS output`);
    }
  }
}

function findPackageJsonFiles(dir) {
  const packageJsonFiles = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    if (dirent.name === 'node_modules' || dirent.name === 'lib' || dirent.name === 'dist') {
      continue;
    }
    const packageJsonPath = path.join(dir, dirent.name, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      packageJsonFiles.push(packageJsonPath);
      continue;
    }
    packageJsonFiles.push(...findPackageJsonFiles(path.join(dir, dirent.name)));
  }
  return packageJsonFiles;
}

for (const packageJsonPath of findPackageJsonFiles(packagesDir)) {
  const dirName = path.basename(path.dirname(packageJsonPath));
  const pkg = readJson(packageJsonPath);
  const exports = pkg.exports;
  if (!exports || typeof exports !== 'object') {
    continue;
  }
  for (const [exportPath, value] of Object.entries(exports)) {
    checkExportConditions(pkg.name ?? dirName, exportPath, value, failures);
  }
}

if (failures.length > 0) {
  console.error('Package export verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Package export verification passed.');
