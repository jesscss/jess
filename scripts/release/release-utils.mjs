import { readdirSync, readFileSync } from 'node:fs';
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
