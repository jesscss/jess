#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const orderedConditions = ['types', 'source', 'import', 'require'];

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
  console.error('Package export condition ordering failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Package export condition ordering passed.');
