import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const ALPHA_BRANCH = 'alpha';
export const ALPHA_SOURCE_REF = 'origin/dev';
export const ALPHA_SOURCE_PROVENANCE_PATH = 'scripts/release/alpha-source-provenance.json';
export const ALPHA_SOURCE_PROVENANCE_SCHEMA = 1;

function git(rootDir, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr ?? '').trim();
    throw new Error(detail || `git ${args.join(' ')} failed.`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

export function fetchAlphaSource(rootDir) {
  git(rootDir, ['fetch', '--quiet', 'origin', 'dev']);
  return git(rootDir, ['rev-parse', '--verify', `${ALPHA_SOURCE_REF}^{commit}`]).stdout.trim();
}

export function currentBranch(rootDir) {
  return git(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
}

function readJson(rootDir, relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, relativePath), 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function readAlphaSourceProvenance(rootDir) {
  const provenance = readJson(rootDir, ALPHA_SOURCE_PROVENANCE_PATH);
  if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) {
    throw new Error(`${ALPHA_SOURCE_PROVENANCE_PATH} must be a JSON object.`);
  }
  if (provenance.schemaVersion !== ALPHA_SOURCE_PROVENANCE_SCHEMA) {
    throw new Error(
      `${ALPHA_SOURCE_PROVENANCE_PATH} must declare schemaVersion ${ALPHA_SOURCE_PROVENANCE_SCHEMA}.`
    );
  }
  if (provenance.sourceRef !== ALPHA_SOURCE_REF) {
    throw new Error(
      `${ALPHA_SOURCE_PROVENANCE_PATH} must declare sourceRef '${ALPHA_SOURCE_REF}'.`
    );
  }
  if (typeof provenance.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(provenance.sourceCommit)) {
    throw new Error(`${ALPHA_SOURCE_PROVENANCE_PATH} must declare a full 40-character sourceCommit.`);
  }
  return provenance;
}

function workingTreeChanges(rootDir) {
  const output = git(rootDir, ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
  return output ? output.split('\n') : [];
}

function changedPaths(rootDir, sourceCommit) {
  const output = git(rootDir, ['diff', '--no-renames', '--name-status', '-z', `${sourceCommit}..HEAD`]).stdout;
  const fields = output.split('\0');
  const changes = [];
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index];
    const file = fields[index + 1];
    if (!status || !file) {
      continue;
    }
    changes.push({ status, file });
  }
  return changes;
}

function isWorkspaceManifest(file) {
  return /^packages\/[^/]+\/package\.json$/u.test(file);
}

function showJson(rootDir, ref, file) {
  const result = git(rootDir, ['show', `${ref}:${file}`], { allowFailure: true });
  if (result.status !== 0) {
    return undefined;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

function manifestOnlyChangesVersion(rootDir, sourceCommit, file) {
  const sourceManifest = showJson(rootDir, sourceCommit, file);
  const alphaManifest = showJson(rootDir, 'HEAD', file);
  if (!sourceManifest || !alphaManifest
    || typeof sourceManifest !== 'object' || Array.isArray(sourceManifest)
    || typeof alphaManifest !== 'object' || Array.isArray(alphaManifest)
    || typeof sourceManifest.version !== 'string' || typeof alphaManifest.version !== 'string') {
    return false;
  }
  const sourceWithoutVersion = { ...sourceManifest };
  const alphaWithoutVersion = { ...alphaManifest };
  delete sourceWithoutVersion.version;
  delete alphaWithoutVersion.version;
  return isDeepStrictEqual(sourceWithoutVersion, alphaWithoutVersion);
}

/**
 * Verify that HEAD is a source-tree projection of the current pushed dev ref.
 * The alpha snapshot may retain only package versions and its exact source
 * provenance record. Release-specific source/docs work belongs on dev first.
 */
export function verifyAlphaSourceSync({ rootDir = process.cwd(), fetch = true } = {}) {
  const errors = [];
  if (currentBranch(rootDir) !== ALPHA_BRANCH) {
    errors.push(`Alpha source sync must run on branch '${ALPHA_BRANCH}'.`);
  }
  const dirty = workingTreeChanges(rootDir);
  if (dirty.length > 0) {
    errors.push(`Alpha source sync requires a clean working tree:\n${dirty.map(line => `  ${line}`).join('\n')}`);
  }

  let sourceCommit;
  try {
    sourceCommit = fetch
      ? fetchAlphaSource(rootDir)
      : git(rootDir, ['rev-parse', '--verify', `${ALPHA_SOURCE_REF}^{commit}`]).stdout.trim();
  } catch (error) {
    errors.push(`Could not resolve current ${ALPHA_SOURCE_REF}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let provenance;
  try {
    provenance = readAlphaSourceProvenance(rootDir);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (sourceCommit && provenance && provenance.sourceCommit !== sourceCommit) {
    errors.push(
      `Alpha provenance records ${provenance.sourceCommit}, but current ${ALPHA_SOURCE_REF} is ${sourceCommit}. `
      + 'Create a new controlled alpha snapshot from the current pushed dev source.'
    );
  }

  if (sourceCommit && provenance && provenance.sourceCommit === sourceCommit) {
    for (const change of changedPaths(rootDir, sourceCommit)) {
      if (change.file === ALPHA_SOURCE_PROVENANCE_PATH && change.status === 'A') {
        continue;
      }
      if (change.status === 'M' && isWorkspaceManifest(change.file)
        && manifestOnlyChangesVersion(rootDir, sourceCommit, change.file)) {
        continue;
      }
      errors.push(
        `Alpha diverges from ${ALPHA_SOURCE_REF} outside the controlled release surface: ${change.status}\t${change.file}`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Alpha source-sync verification failed:\n- ${errors.join('\n- ')}`);
  }
  return { sourceCommit, provenance };
}
