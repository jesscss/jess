#!/usr/bin/env node
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function packageLibDirs(root = process.cwd()) {
  const packagesRoot = join(root, 'packages');
  const dirs = [];
  if (!existsSync(packagesRoot)) {
    return dirs;
  }

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === 'node_modules') {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.name === 'lib' && existsSync(join(dir, 'package.json'))) {
        dirs.push(full);
        continue;
      }
      walk(full);
    }
  }

  walk(packagesRoot);
  return dirs.sort();
}

function removePackageLibDirs(root = process.cwd()) {
  const dirs = packageLibDirs(root);
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  return dirs;
}

function run() {
  const removed = removePackageLibDirs();
  console.log(`Removed ${removed.length} package lib dir(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}

export {
  packageLibDirs,
  removePackageLibDirs
};
