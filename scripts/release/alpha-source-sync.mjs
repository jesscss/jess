import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const ALPHA_BRANCH = 'alpha';
export const ALPHA_SOURCE_REF = 'origin/dev';
export const ALPHA_SOURCE_PROVENANCE_PATH = 'scripts/release/alpha-source-provenance.json';
export const ALPHA_SOURCE_PROVENANCE_SCHEMA = 1;

/*
 * An existing alpha may need the current release-safety policy in order to
 * validate its already-recorded source snapshot. These are release controls,
 * not product source: permit them only when alpha copies the exact files from
 * the current pushed dev ref.
 */
export const ALPHA_RELEASE_CONTROL_FILES = new Set([
  'scripts/release/alpha-source-sync.mjs',
  'scripts/release/verify-alpha-source-sync.mjs',
  'scripts/release/__tests__/alpha-source-sync.test.ts'
]);

/*
 * `dev` remains active while an alpha gate runs. Requiring its tip to stay frozen
 * makes a valid release snapshot needlessly impossible to publish; accepting an
 * unboundedly old snapshot is no better. Keep the release snapshot recent without
 * turning ordinary, unrelated dev work into a release race.
 */
export const MAX_ALPHA_SOURCE_DRIFT_COMMITS = 12;

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
    throw new Error(`Could not read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function readAlphaSourceProvenance(rootDir) {
  const provenance = readJson(rootDir, ALPHA_SOURCE_PROVENANCE_PATH);
  if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) {
    throw new Error(`${ALPHA_SOURCE_PROVENANCE_PATH} must be a JSON object.`);
  }
  if (provenance.schemaVersion !== ALPHA_SOURCE_PROVENANCE_SCHEMA) {
    throw new Error(`${ALPHA_SOURCE_PROVENANCE_PATH} must declare schemaVersion ${ALPHA_SOURCE_PROVENANCE_SCHEMA}.`);
  }
  if (provenance.sourceRef !== ALPHA_SOURCE_REF) {
    throw new Error(`${ALPHA_SOURCE_PROVENANCE_PATH} must declare sourceRef '${ALPHA_SOURCE_REF}'.`);
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

function isAncestor(rootDir, ancestor, descendant) {
  return git(rootDir, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFailure: true }).status === 0;
}

function commitDistance(rootDir, ancestor, descendant) {
  return Number(git(rootDir, ['rev-list', '--count', `${ancestor}..${descendant}`]).stdout.trim());
}

function isWorkspaceManifest(file) {
  return /^packages\/(?:[^/]+\/)+package\.json$/u.test(file);
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

function matchesRefFile(rootDir, ref, file) {
  return git(rootDir, ['diff', '--quiet', ref, 'HEAD', '--', file], { allowFailure: true }).status === 0;
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
 * Verify that HEAD is a source-tree projection of its recorded pushed-dev
 * snapshot. The snapshot must remain a recent ancestor of current dev; this
 * permits ordinary dev progress during the alpha gate without publishing an
 * arbitrarily stale tree. The alpha snapshot may retain only package versions
 * and its exact source provenance record.
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

  let sourceDrift;
  if (sourceCommit && provenance) {
    if (!isAncestor(rootDir, provenance.sourceCommit, sourceCommit)) {
      errors.push(`Alpha provenance source ${provenance.sourceCommit} is not an ancestor of current ${ALPHA_SOURCE_REF} ${sourceCommit}. `
        + 'Create a new controlled alpha snapshot from a pushed dev source.');
    } else {
      sourceDrift = commitDistance(rootDir, provenance.sourceCommit, sourceCommit);
      if (sourceDrift > MAX_ALPHA_SOURCE_DRIFT_COMMITS) {
        errors.push(`Alpha provenance is ${sourceDrift} commits behind current ${ALPHA_SOURCE_REF}; `
          + `the maximum allowed drift is ${MAX_ALPHA_SOURCE_DRIFT_COMMITS}. `
          + 'Create a new controlled alpha snapshot from the current pushed dev source.');
      }
    }

    /*
     * Compare to the recorded source, not the moving dev tip. A valid alpha is a
     * projection of that immutable source snapshot, with package-version and
     * provenance exceptions only.
     */
    for (const change of changedPaths(rootDir, provenance.sourceCommit)) {
      if (change.file === ALPHA_SOURCE_PROVENANCE_PATH && change.status === 'A') {
        continue;
      }
      if (ALPHA_RELEASE_CONTROL_FILES.has(change.file)
        && matchesRefFile(rootDir, sourceCommit, change.file)) {
        continue;
      }
      if (change.status === 'M' && isWorkspaceManifest(change.file)
        && manifestOnlyChangesVersion(rootDir, provenance.sourceCommit, change.file)) {
        continue;
      }
      errors.push(`Alpha diverges from ${ALPHA_SOURCE_REF} outside the controlled release surface: ${change.status}\t${change.file}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Alpha source-sync verification failed:\n- ${errors.join('\n- ')}`);
  }
  return { sourceCommit, provenance, sourceDrift };
}
