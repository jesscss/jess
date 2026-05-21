#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const orderedConditions = ['types', 'source', 'import', 'require'];
const forbiddenRootExportPatterns = [
  {
    pattern: /export\s+\*\s+from\s+['"]\.\/tree\/util\/render-buffer\.js['"]/u,
    message: '@jesscss/core root must not wildcard re-export render-buffer internals'
  },
  {
    pattern: /export\s+\{[^}]*(?:renderNodeToBuffer|renderNodeToWriter|renderNodeToString|renderChosenOutput|renderNoOutputEffect|writeRootAwareChosenOutput)[^}]*\}\s+from\s+['"]\.\/tree\/util\/render-buffer\.js['"]/u,
    message: '@jesscss/core root must not re-export render-buffer bridge helpers'
  }
];

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
  for (const forbidden of forbiddenRootExportPatterns) {
    if (forbidden.pattern.test(coreIndexSource)) {
      failures.push(`@jesscss/core root export: ${forbidden.message}`);
    }
  }
}

for (const dirent of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) {
    continue;
  }
  const packageJsonPath = path.join(packagesDir, dirent.name, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    continue;
  }
  const pkg = readJson(packageJsonPath);
  const exports = pkg.exports;
  if (!exports || typeof exports !== 'object') {
    continue;
  }
  for (const [exportPath, value] of Object.entries(exports)) {
    checkExportConditions(pkg.name ?? dirent.name, exportPath, value, failures);
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
