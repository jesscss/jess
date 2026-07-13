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

/**
 * Return the list of values that appear more than once in `list`, each reported
 * exactly once and in first-seen order. Used to fail the alpha publish-set on a
 * malformed allowlist (duplicate package names) BEFORE the silent de-dup hides
 * it — a duplicate is always an editing mistake and must surface loudly.
 */
export function findAllowlistDuplicates(list) {
  const seen = new Set();
  const duplicates = [];
  const reported = new Set();
  for (const name of list) {
    if (seen.has(name)) {
      if (!reported.has(name)) {
        duplicates.push(name);
        reported.add(name);
      }
    } else {
      seen.add(name);
    }
  }
  return duplicates;
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

/**
 * True for repo-relative paths that the release BUILD regenerates and that must
 * never block the clean-tree gate:
 *   - `.cursor/**`             : transient debugging state
 *   - `**​/lib/**`              : compiled output (gitignored, but be explicit)
 *   - `**​/etc/*.api.md`        : API-Extractor reports, rewritten by the build
 * The gate checks SOURCE cleanliness, not build artifacts.
 */
export function isReleaseArtifactPath(file) {
  if (file.startsWith('.cursor/')) return true;
  if (file === 'lib' || file.startsWith('lib/') || file.includes('/lib/')) return true;
  if (/(^|\/)etc\/[^/]+\.api\.md$/.test(file)) return true;
  return false;
}

/**
 * Parse a semver string into comparable parts. Returns null if it is not a
 * recognizable `X.Y.Z[-prerelease][+build]`.
 */
function parseSemver(version) {
  const match = String(version)
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    pre: match[4] ? match[4].split('.') : []
  };
}

/**
 * Compare two semver strings by precedence (SemVer §11). Returns -1, 0, or 1.
 * Falls back to a stable string comparison if either side is not valid semver,
 * so callers never crash on registry data they did not expect.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  // A version with a prerelease has LOWER precedence than one without.
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const nx = parseInt(x, 10);
      const ny = parseInt(y, 10);
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (xNum && !yNum) {
      return -1; // numeric identifiers have lower precedence than alphanumeric
    } else if (!xNum && yNum) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Given `X.Y.Z-alpha.N`, return `X.Y.Z-alpha.(N+1)`. Throws on a non-alpha input
 * so a bad publishedMax can never silently produce a garbage version.
 */
export function nextAlphaAfter(version) {
  const parsed = parseAlphaVersion(version);
  if (!parsed) {
    throw new Error(
      `Cannot compute the next alpha after non-alpha version '${version}' (expected X.Y.Z-alpha.N).`
    );
  }
  return `${parsed.base}-alpha.${parsed.num + 1}`;
}

/**
 * Query npm for every published version of a package. Returns a string array
 * (possibly empty). Any npm error / empty / unpublished package → `[]`, so the
 * resolver treats "nothing published" and "npm unreachable for this name" alike.
 */
export function npmViewVersions(pkgName) {
  const result = spawnSync('npm', ['view', pkgName, 'versions', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    return [];
  }
  const output = (result.stdout ?? '').trim();
  if (!output) {
    return [];
  }
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'string') {
      return [parsed];
    }
    if (Array.isArray(parsed)) {
      return parsed.filter(v => typeof v === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Resolve the single lockstep alpha version to publish for the whole allowlist,
 * intent-first and registry-guarded. Rule (owner-agreed):
 *
 *   1. intended      = max-by-semver of allowlisted manifest versions (the
 *                      lockstep intent already written in the repo).
 *   2. publishedMax  = max-by-semver over the allowlist of each package's
 *                      highest PUBLISHED version on npm (null if nothing is
 *                      published anywhere in the set).
 *   3. Intent-first  : publishedMax === null OR intended > publishedMax
 *                      → use intended as-is (honors a deliberate forward jump,
 *                      e.g. a new minor even if its alpha-number is lower).
 *   4. Registry-guard: otherwise (intended <= publishedMax) →
 *                      resolved = nextAlphaAfter(publishedMax), then keep
 *                      incrementing while resolved is already published for ANY
 *                      allowlisted package (guarantees a clean fresh publish).
 *
 * The resolved version is ALWAYS fresh (unpublished) for every allowlisted
 * package, so publish-alpha never has to skip or backward-retag.
 *
 * `viewVersions` is injectable for testing; defaults to a real npm query.
 */
export function resolveAlphaPublishVersion({
  rootDir = process.cwd(),
  allowlistPath,
  plan,
  viewVersions = npmViewVersions
} = {}) {
  allowlistPath ??= path.join(rootDir, 'scripts', 'release', 'alpha-allowlist.json');
  plan ??= getAlphaReleasePlan({ rootDir, allowlistPath });
  if (plan.errors.length > 0) {
    throw new Error(`Cannot resolve alpha version: validation failed:\n- ${plan.errors.join('\n- ')}`);
  }

  const manifestVersions = plan.packages.map(pkg => pkg.manifest.version).filter(Boolean);
  if (manifestVersions.length === 0) {
    throw new Error('No allowlisted packages with a version to resolve from.');
  }
  const intended = manifestVersions.reduce((max, v) => (compareSemver(v, max) > 0 ? v : max));
  if (!parseAlphaVersion(intended)) {
    throw new Error(
      `Intended lockstep version '${intended}' is not an alpha version (expected X.Y.Z-alpha.N).`
    );
  }

  const publishedByPackage = new Map();
  const publishedAll = new Set();
  let publishedMax = null;
  for (const name of plan.allowlist) {
    const versions = viewVersions(name) ?? [];
    publishedByPackage.set(name, versions);
    for (const v of versions) {
      publishedAll.add(v);
      if (publishedMax === null || compareSemver(v, publishedMax) > 0) {
        publishedMax = v;
      }
    }
  }

  let resolved;
  let reason;
  if (publishedMax === null || compareSemver(intended, publishedMax) > 0) {
    resolved = intended;
    reason = publishedMax === null ? 'nothing-published' : 'intended-ahead';
  } else {
    resolved = nextAlphaAfter(publishedMax);
    while (publishedAll.has(resolved)) {
      resolved = nextAlphaAfter(resolved);
    }
    reason = 'registry-guarded-increment';
  }

  return { intended, publishedMax, resolved, reason, plan, publishedByPackage };
}

/**
 * Write `version` into every publishable (non-private) workspace package so the
 * lockstep invariant holds. Returns `{ changed, restore }`: `changed` is the
 * list of manifest paths actually rewritten, and `restore()` puts their exact
 * prior bytes back (used by dry-runs so the tree is never left mutated).
 */
export function applyLockstepVersion(rootDir, version) {
  const allPackages = listWorkspacePackages(rootDir);
  const originals = [];
  for (const [, pkg] of allPackages) {
    if (pkg.manifest.private) continue;
    const raw = readFileSync(pkg.packageJsonPath, 'utf8');
    const pkgJson = JSON.parse(raw);
    if (pkgJson.version === version) continue;
    originals.push({ path: pkg.packageJsonPath, raw });
    pkgJson.version = version;
    writeFileSync(pkg.packageJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
  }
  return {
    changed: originals.map(entry => entry.path),
    restore() {
      for (const entry of originals) {
        writeFileSync(entry.path, entry.raw);
      }
    }
  };
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

  const duplicates = findAllowlistDuplicates(allowlist);
  if (duplicates.length > 0) {
    errors.push(
      `Duplicate allowlist entries (each package must appear once): ${duplicates.join(', ')}`
    );
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

  // Lockstep spans every publishable (non-private) workspace package, not just the
  // allowlist: incrementAlphaVersions and the changesets `fixed: [["*"]]` group both
  // bump all non-private packages together, so drift in a not-yet-allowlisted package
  // (e.g. one about to be added to the set) must fail the publish before it lands.
  const versionsByValue = new Map();
  for (const [name, info] of byName) {
    if (info.manifest.private === true) {
      continue;
    }
    const version = info.manifest.version;
    if (!version) {
      continue;
    }
    if (!versionsByValue.has(version)) {
      versionsByValue.set(version, []);
    }
    versionsByValue.get(version).push(name);
  }
  if (versionsByValue.size > 1) {
    const detail = [...versionsByValue.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([version, names]) => `${version} (${names.sort().join(', ')})`)
      .join('; ');
    errors.push(
      `Lockstep version invariant failed: all non-private workspace packages must share one version. Found: ${detail}`
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
