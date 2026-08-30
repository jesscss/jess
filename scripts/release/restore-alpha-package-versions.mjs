#!/usr/bin/env node
/**
 * After the controlled dev -> alpha two-tree patch, preserve only package
 * versions from the alpha recovery ref.  The imported manifests remain the
 * dev manifests in every other field.
 *
 * Usage:
 *   node scripts/release/restore-alpha-package-versions.mjs --from alpha-pre-refresh --stage
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  compareSemver,
  listWorkspacePackages,
  preserveRecoveryManifestVersion
} from './release-utils.mjs';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function parseArgs(argv) {
  let from = null;
  let stage = false;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from') {
      from = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--stage') {
      stage = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, from: null, stage: false };
    }
    throw new Error(`Unknown argument '${arg}'.`);
  }
  if (!from) {
    throw new Error('Missing required --from <recovery-ref>.');
  }
  if (!stage) {
    throw new Error('Missing required --stage; restored manifest versions must enter the controlled snapshot index.');
  }
  return { help: false, from, stage };
}

function gitShow(rootDir, ref, relativePath) {
  const result = spawnSync('git', ['show', `${ref}:${relativePath}`], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    if (
      stderr.includes(`path '${relativePath}' exists on disk, but not in '${ref}'`)
      || stderr.includes(`Path '${relativePath}' does not exist in '${ref}'`)
    ) {
      return null;
    }
    throw new Error(`Could not read ${relativePath} from recovery ref '${ref}': ${
      stderr || 'git show failed'
    }`);
  }
  return result.stdout;
}

function gitAdd(rootDir, paths) {
  if (paths.length === 0) {
    return;
  }
  const result = spawnSync('git', ['add', '--', ...paths], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`Could not stage restored package manifests: ${result.stderr.trim() || 'git add failed'}`);
  }
}

function main() {
  const { help, from } = parseArgs(process.argv);
  if (help) {
    console.log('Usage: node scripts/release/restore-alpha-package-versions.mjs --from <recovery-ref> --stage');
    return;
  }

  const rootDir = process.cwd();
  const packages = listWorkspacePackages(rootDir);
  const recoveryByPath = new Map();
  const recoveryVersionCounts = new Map();
  let recoveryVersion = null;
  for (const pkg of packages.values()) {
    const relativePath = path
      .relative(rootDir, pkg.packageJsonPath)
      .replaceAll(path.sep, '/');
    const recoveryRaw = gitShow(rootDir, from, relativePath);
    if (recoveryRaw === null) {
      continue;
    }
    recoveryByPath.set(relativePath, recoveryRaw);
    const recoveryManifest = JSON.parse(recoveryRaw);
    const version = recoveryManifest.version;
    if (!recoveryManifest.private && typeof version === 'string' && version.length > 0) {
      recoveryVersionCounts.set(version, (recoveryVersionCounts.get(version) ?? 0) + 1);
    }
  }
  for (const [version, count] of recoveryVersionCounts) {
    if (
      recoveryVersion === null
      || count > recoveryVersionCounts.get(recoveryVersion)
      || (count === recoveryVersionCounts.get(recoveryVersion) && compareSemver(version, recoveryVersion) > 0)
    ) {
      recoveryVersion = version;
    }
  }

  let changed = 0;
  const changedPaths = [];
  for (const pkg of packages.values()) {
    const relativePath = path
      .relative(rootDir, pkg.packageJsonPath)
      .replaceAll(path.sep, '/');
    const importedRaw = readFileSync(pkg.packageJsonPath, 'utf8');
    const importedManifest = JSON.parse(importedRaw);
    const recoveryRaw = recoveryByPath.get(relativePath) ?? null;
    if (recoveryRaw === null) {
      if (recoveryVersion === null || importedManifest.version === recoveryVersion) {
        console.log(`${relativePath}: new in imported source; keeping ${
          importedManifest.version ?? '(missing)'
        }`);
        continue;
      }
      writeFileSync(
        pkg.packageJsonPath,
        `${JSON.stringify({ ...importedManifest, version: recoveryVersion }, null, 2)}\n`
      );
      changed += 1;
      changedPaths.push(relativePath);
      console.log(`${relativePath}: new in imported source; ${importedManifest.version ?? '(missing)'} -> ${
        recoveryVersion
      }`);
      continue;
    }
    const recoveryManifest = JSON.parse(recoveryRaw);
    if (recoveryManifest.private === true && importedManifest.private !== true) {
      if (recoveryVersion === null || importedManifest.version === recoveryVersion) {
        console.log(`${relativePath}: promoted from private; keeping ${
          importedManifest.version ?? '(missing)'
        }`);
        continue;
      }
      writeFileSync(
        pkg.packageJsonPath,
        `${JSON.stringify({ ...importedManifest, version: recoveryVersion }, null, 2)}\n`
      );
      changed += 1;
      changedPaths.push(relativePath);
      console.log(`${relativePath}: promoted from private; ${
        importedManifest.version ?? '(missing)'
      } -> ${recoveryVersion}`);
      continue;
    }
    const restoredManifest = preserveRecoveryManifestVersion(
      importedManifest,
      recoveryManifest
    );
    if (restoredManifest.version === importedManifest.version) {
      continue;
    }
    writeFileSync(
      pkg.packageJsonPath,
      `${JSON.stringify(restoredManifest, null, 2)}\n`
    );
    changed += 1;
    changedPaths.push(relativePath);
    console.log(`${relativePath}: ${importedManifest.version ?? '(missing)'} -> ${
      restoredManifest.version
    }`);
  }
  gitAdd(rootDir, changedPaths);
  console.log(`Preserved and staged recovery alpha versions in ${changed} package manifest(s); all other fields remain imported.`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
