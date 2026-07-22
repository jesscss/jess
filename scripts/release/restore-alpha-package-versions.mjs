#!/usr/bin/env node
/**
 * After the controlled dev -> alpha two-tree patch, preserve only package
 * versions from the alpha recovery ref.  The imported manifests remain the
 * dev manifests in every other field.
 *
 * Usage:
 *   node scripts/release/restore-alpha-package-versions.mjs --from alpha-pre-alpha9-cut
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  listWorkspacePackages,
  preserveRecoveryManifestVersion
} from './release-utils.mjs';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function parseArgs(argv) {
  let from = null;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from') {
      from = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { help: true, from: null };
    }
    throw new Error(`Unknown argument '${arg}'.`);
  }
  if (!from) {
    throw new Error('Missing required --from <recovery-ref>.');
  }
  return { help: false, from };
}

function gitShow(rootDir, ref, relativePath) {
  const result = spawnSync('git', ['show', `${ref}:${relativePath}`], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not read ${relativePath} from recovery ref '${ref}': ${
        result.stderr.trim() || 'git show failed'
      }`
    );
  }
  return result.stdout;
}

function main() {
  const { help, from } = parseArgs(process.argv);
  if (help) {
    console.log(
      'Usage: node scripts/release/restore-alpha-package-versions.mjs --from <recovery-ref>'
    );
    return;
  }

  const rootDir = process.cwd();
  const packages = listWorkspacePackages(rootDir);
  let changed = 0;
  for (const pkg of packages.values()) {
    const relativePath = path
      .relative(rootDir, pkg.packageJsonPath)
      .replaceAll(path.sep, '/');
    const importedRaw = readFileSync(pkg.packageJsonPath, 'utf8');
    const importedManifest = JSON.parse(importedRaw);
    const recoveryManifest = JSON.parse(gitShow(rootDir, from, relativePath));
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
    console.log(
      `${relativePath}: ${importedManifest.version ?? '(missing)'} -> ${
        restoredManifest.version
      }`
    );
  }
  console.log(
    `Preserved recovery alpha versions in ${changed} package manifest(s); all other fields remain imported.`
  );
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
