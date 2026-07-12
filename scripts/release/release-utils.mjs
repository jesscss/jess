import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RUNTIME_DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function listWorkspacePackages(rootDir) {
  const packagesDir = path.join(rootDir, 'packages');
  const entries = readdirSync(packagesDir, { withFileTypes: true });
  const byName = new Map();

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageJsonPath = path.join(packagesDir, entry.name, 'package.json');
    let manifest;
    try {
      manifest = readJson(packageJsonPath);
    } catch {
      continue;
    }
    if (!manifest.name) {
      continue;
    }
    byName.set(manifest.name, {
      name: manifest.name,
      dir: path.join(packagesDir, entry.name),
      packageJsonPath,
      manifest
    });
  }

  return byName;
}

export function getRuntimeWorkspaceDeps(manifest) {
  const deps = new Set();
  for (const field of RUNTIME_DEP_FIELDS) {
    const section = manifest[field];
    if (!section || typeof section !== 'object') {
      continue;
    }
    for (const [name, version] of Object.entries(section)) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        deps.add(name);
      }
    }
  }
  return [...deps].sort();
}

function topoSortAllowlist(allowlist, byName) {
  const indegree = new Map();
  const forward = new Map();
  const allowlistSet = new Set(allowlist);

  for (const name of allowlist) {
    indegree.set(name, 0);
    forward.set(name, []);
  }

  for (const name of allowlist) {
    const pkg = byName.get(name);
    const deps = getRuntimeWorkspaceDeps(pkg.manifest);
    for (const dep of deps) {
      if (!allowlistSet.has(dep)) {
        continue;
      }
      forward.get(dep).push(name);
      indegree.set(name, (indegree.get(name) ?? 0) + 1);
    }
  }

  const queue = [...allowlist.filter(name => (indegree.get(name) ?? 0) === 0)].sort();
  const out = [];
  while (queue.length > 0) {
    const current = queue.shift();
    out.push(current);
    for (const next of forward.get(current) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  if (out.length !== allowlist.length) {
    const unresolved = allowlist.filter(name => !out.includes(name));
    throw new Error(`Cycle detected in allowlisted runtime workspace dependencies: ${unresolved.join(', ')}`);
  }
  return out;
}

export function parseAlphaVersion(version) {
  const match = version.match(/^(.+)-alpha\.(\d+)$/);
  if (!match) return null;
  return { base: match[1], num: parseInt(match[2], 10) };
}

export function incrementAlphaVersions({ rootDir = process.cwd(), allowlistPath } = {}) {
  allowlistPath ??= path.join(rootDir, 'scripts', 'release', 'alpha-allowlist.json');
  const plan = getAlphaReleasePlan({ rootDir, allowlistPath });
  if (plan.errors.length > 0) {
    throw new Error(`Cannot increment: validation failed:\n- ${plan.errors.join('\n- ')}`);
  }
  const currentVersion = plan.packages[0]?.manifest.version;
  if (!currentVersion) {
    throw new Error('No packages in allowlist');
  }
  const parsed = parseAlphaVersion(currentVersion);
  if (!parsed) {
    throw new Error(`Current version '${currentVersion}' is not an alpha version (expected X.Y.Z-alpha.N)`);
  }
  const nextVersion = `${parsed.base}-alpha.${parsed.num + 1}`;

  const allPackages = listWorkspacePackages(rootDir);
  for (const [, pkg] of allPackages) {
    if (pkg.manifest.private) continue;
    const pkgJson = JSON.parse(readFileSync(pkg.packageJsonPath, 'utf8'));
    pkgJson.version = nextVersion;
    writeFileSync(pkg.packageJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
  }

  return { previousVersion: currentVersion, nextVersion, plan };
}

/**
 * Query npm for whether a specific version of a package is already published.
 * Returns true only when npm reports that exact version. Any npm error / empty
 * response (e.g. package or version not found) is treated as "not published".
 */
export function npmVersionPublished(pkgName, version) {
  const result = spawnSync('npm', ['view', `${pkgName}@${version}`, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    return false;
  }
  const output = (result.stdout ?? '').trim();
  if (!output) {
    return false;
  }
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'string') {
      return parsed === version;
    }
    if (Array.isArray(parsed)) {
      return parsed.includes(version);
    }
    return false;
  } catch {
    return output.includes(version);
  }
}

/**
 * Determine whether the lockstep alpha `version` is already published across the
 * allowlisted packages. Classifies into:
 *   - 'none'    : no allowlisted package has this version → publish V as-is
 *   - 'partial' : some do, some don't → a prior partial publish; resume as-is
 *                 (per-package skip in publish-alpha handles the already-done ones)
 *   - 'all'     : every allowlisted package already has this version published
 *
 * `viewVersion` is injectable for testing; defaults to a real npm query.
 */
export function getAlphaPublishStatus({ plan, version, viewVersion = npmVersionPublished }) {
  const published = [];
  const missing = [];
  for (const pkgName of plan.allowlist) {
    if (viewVersion(pkgName, version)) {
      published.push(pkgName);
    } else {
      missing.push(pkgName);
    }
  }
  let state;
  if (published.length === 0) {
    state = 'none';
  } else if (missing.length === 0) {
    state = 'all';
  } else {
    state = 'partial';
  }
  return { state, version, published, missing, total: plan.allowlist.length };
}

export function getAlphaReleasePlan({
  rootDir = process.cwd(),
  allowlistPath = path.join(rootDir, 'scripts/release/alpha-allowlist.json')
} = {}) {
  const byName = listWorkspacePackages(rootDir);
  const allowlist = readJson(allowlistPath);
  const errors = [];

  if (!Array.isArray(allowlist) || allowlist.some(name => typeof name !== 'string' || name.length === 0)) {
    throw new Error(`Allowlist must be a JSON string array: ${allowlistPath}`);
  }

  const dedupedAllowlist = [...new Set(allowlist)];
  const allowlistSet = new Set(dedupedAllowlist);
  const blocked = [];
  const packages = [];

  for (const name of dedupedAllowlist) {
    const info = byName.get(name);
    if (!info) {
      errors.push(`Allowlisted package not found in workspace: ${name}`);
      continue;
    }
    if (info.manifest.private === true) {
      errors.push(`Allowlisted package is private: ${name}`);
      continue;
    }
    packages.push(info);
  }

  const versions = new Set(packages.map(pkg => pkg.manifest.version).filter(Boolean));
  if (versions.size > 1) {
    errors.push(
      `Lockstep version invariant failed in allowlist. Found versions: ${[...versions].sort().join(', ')}`
    );
  }

  for (const pkg of packages) {
    const runtimeWorkspaceDeps = getRuntimeWorkspaceDeps(pkg.manifest);
    for (const depName of runtimeWorkspaceDeps) {
      const dep = byName.get(depName);
      if (!dep) {
        blocked.push(
          `${pkg.name} depends on unknown workspace package ${depName}`
        );
        continue;
      }
      if (dep.manifest.private === true) {
        blocked.push(
          `${pkg.name} depends on private workspace package ${depName}`
        );
        continue;
      }
      if (!allowlistSet.has(depName)) {
        blocked.push(
          `${pkg.name} depends on non-allowlisted workspace package ${depName}`
        );
      }
    }
  }

  if (blocked.length > 0) {
    errors.push(...blocked);
  }

  let publishOrder = [];
  if (errors.length === 0) {
    publishOrder = topoSortAllowlist(dedupedAllowlist, byName);
  }

  return {
    allowlist: dedupedAllowlist,
    packagesByName: byName,
    packages,
    publishOrder,
    errors
  };
}
