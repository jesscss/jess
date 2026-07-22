#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeWorkspaceDeps, listWorkspacePackages } from './release/release-utils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/** Dependency-first order for every workspace package with a build tsconfig. */
export function orderBuildPackages(packages) {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]));
  const indegree = new Map(packages.map(pkg => [pkg.name, 0]));
  const dependents = new Map(packages.map(pkg => [pkg.name, []]));

  for (const pkg of packages) {
    for (const dependency of getRuntimeWorkspaceDeps(pkg.manifest)) {
      if (!byName.has(dependency)) {
        continue;
      }
      dependents.get(dependency).push(pkg.name);
      indegree.set(pkg.name, indegree.get(pkg.name) + 1);
    }
  }

  const ready = packages
    .map(pkg => pkg.name)
    .filter(name => indegree.get(name) === 0)
    .sort();
  const ordered = [];
  while (ready.length > 0) {
    const name = ready.shift();
    ordered.push(byName.get(name));
    for (const dependent of dependents.get(name).sort()) {
      const remaining = indegree.get(dependent) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (ordered.length !== packages.length) {
    const unresolved = packages
      .map(pkg => pkg.name)
      .filter(name => !ordered.some(pkg => pkg.name === name));
    throw new Error(`Cycle detected in strict-build workspace dependencies: ${unresolved.join(', ')}`);
  }
  return ordered;
}

export function countTypeScriptDiagnostics(output) {
  return output.match(/error TS\d+:/gu)?.length ?? 0;
}

export function verifyTypes(rootDir = ROOT) {
  const packages = [...listWorkspacePackages(rootDir).values()]
    .filter(pkg => existsSync(path.join(pkg.dir, 'tsconfig.build.json')));
  const ordered = orderBuildPackages(packages);
  const failures = [];

  console.log(`Strict production type verification (${ordered.length} build configs, dependency order):`);
  for (const [index, pkg] of ordered.entries()) {
    const relativeDir = path.relative(rootDir, pkg.dir);
    console.log(`\n[${index + 1}/${ordered.length}] ${pkg.name} (${relativeDir})`);
    const result = spawnSync(PNPM, [
      'exec', 'tsc', '-p', 'tsconfig.build.json', '--noEmit', '--pretty', 'false'
    ], {
      cwd: pkg.dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.error) {
      throw result.error;
    }
    if (result.status === 0) {
      console.log('  passed');
      continue;
    }
    const diagnostics = countTypeScriptDiagnostics(output);
    failures.push({ name: pkg.name, relativeDir, diagnostics, output });
    process.stdout.write(output);
  }

  if (failures.length === 0) {
    console.log(`\nStrict production type verification passed (${ordered.length}/${ordered.length} configs).`);
    return;
  }

  const diagnostics = failures.reduce((total, failure) => total + failure.diagnostics, 0);
  console.error(`\nStrict production type verification failed: ${failures.length}/${ordered.length} configs, ${diagnostics} diagnostics.`);
  for (const failure of failures) {
    console.error(`- ${failure.name} (${failure.relativeDir}): ${failure.diagnostics}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyTypes();
}
