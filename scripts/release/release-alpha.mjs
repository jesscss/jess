#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  applyLockstepVersion,
  getAlphaReleasePlan,
  isReleaseArtifactPath,
  resolveAlphaPublishVersion
} from './release-utils.mjs';

function parseArgs(argv) {
  const options = {
    dryRun: false,
    noPush: false,
    skipVersion: false,
    skipPublish: false,
    skipCheck: false,
    bump: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    if (arg === '--no-push') options.noPush = true;
    if (arg === '--skip-version') options.skipVersion = true;
    if (arg === '--skip-publish') options.skipPublish = true;
    // Skip the heavy step-2 preflight (release:alpha:check) when the current
    // tree was already verified — for a fast republish. Default stays full-check.
    if (arg === '--skip-check') options.skipCheck = true;
    // On an already-published manifest version: default is to error; --bump
    // opts into auto-incrementing to the next unused -alpha.N instead.
    if (arg === '--bump') options.bump = true;
    // GATED: also move the npm `latest` dist-tag to the published version
    // (forwarded to publish-alpha via ALPHA_SET_LATEST). OFF by default.
    if (arg === '--set-latest') options.setLatest = true;
  }
  return options;
}

function run(command, args, cwd = process.cwd()) {
  const rendered = [command, ...args].join(' ');
  console.log(`\n$ ${rendered}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 1}): ${rendered}`);
  }
}

function runCapture(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(stderr || `Command failed (${result.status ?? 1}): ${command} ${args.join(' ')}`);
  }
  return (result.stdout ?? '').trim();
}

function getCurrentBranch(rootDir) {
  return runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], rootDir);
}

function getDirtyFiles(rootDir) {
  const output = runCapture('git', ['status', '--porcelain'], rootDir);
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.slice(3))
    .filter(Boolean);
}

function assertReadyWorkingTree(rootDir) {
  const dirty = getDirtyFiles(rootDir).filter(file => !isReleaseArtifactPath(file));
  if (dirty.length > 0) {
    throw new Error(
      `Working tree is not clean. Commit or stash source changes first `
      + `(build artifacts like lib/ and etc/*.api.md are ignored):\n- ${dirty.join('\n- ')}`
    );
  }
}

function getReleaseState(rootDir) {
  const allowlistPath = path.join(rootDir, 'scripts/release/alpha-allowlist.json');
  const plan = getAlphaReleasePlan({ rootDir, allowlistPath });
  if (plan.errors.length > 0) {
    throw new Error(`Alpha publish-set validation failed:\n- ${plan.errors.join('\n- ')}`);
  }
  const version = plan.packages[0]?.manifest.version ?? '';
  if (!version.includes('-alpha.')) {
    throw new Error(`Alpha release requires '-alpha.' version suffix. Current allowlist version: ${version}`);
  }
  return { plan, version };
}

function tagExists(rootDir, tag) {
  const result = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    cwd: rootDir,
    stdio: 'ignore',
    shell: process.platform === 'win32'
  });
  return result.status === 0;
}

/** Synchronous sleep (no extra deps) for the smoke-check propagation backoff. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Read the version npm currently resolves for `pkgName@tag`, or null. */
function viewTagVersion(pkgName, tag) {
  const result = spawnSync('npm', ['view', `${pkgName}@${tag}`, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    return null;
  }
  const raw = (result.stdout ?? '').trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) return parsed.at(-1) ?? null;
    return null;
  } catch {
    return raw;
  }
}

/**
 * Smoke check that TOLERATES registry propagation lag. Newly-created scoped
 * packages (and fresh versions) can take tens of seconds to become queryable by
 * `npm view`, so a single immediate query false-reports a successful publish as
 * a missing/E404 package. This polls each not-yet-visible package with backoff
 * before deciding, and only warns about packages still not showing the expected
 * version after the full window.
 */
function smokeCheck(plan, expectedVersion, { attempts = 6, delayMs = 10000 } = {}) {
  console.log('\nNPM alpha tag smoke check (tolerating registry propagation lag)...');
  const lastSeen = new Map(plan.allowlist.map(name => [name, '(not found)']));
  const confirmed = new Set();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const pkgName of plan.allowlist) {
      if (confirmed.has(pkgName)) continue;
      const seen = viewTagVersion(pkgName, 'alpha');
      lastSeen.set(pkgName, seen ?? '(not found)');
      if (seen === expectedVersion) confirmed.add(pkgName);
    }
    const remaining = plan.allowlist.filter(name => !confirmed.has(name));
    if (remaining.length === 0) break;
    if (attempt < attempts) {
      console.log(
        `  attempt ${attempt}/${attempts}: ${remaining.length} package(s) not yet showing `
        + `${expectedVersion}; waiting ${delayMs / 1000}s for propagation...`
      );
      sleepSync(delayMs);
    }
  }

  for (const pkgName of plan.allowlist) {
    const seen = lastSeen.get(pkgName);
    const good = confirmed.has(pkgName);
    console.log(`- ${pkgName}@alpha => ${seen}${good ? '' : `  (expected ${expectedVersion})`}`);
  }
  console.log(`\nExpected published version: ${expectedVersion}`);

  const stillMissing = plan.allowlist.filter(name => !confirmed.has(name));
  if (stillMissing.length > 0) {
    console.warn(
      `\nWarning: ${stillMissing.length} package(s) did not show ${expectedVersion} on the 'alpha' `
      + `tag within ${(attempts * delayMs) / 1000}s: ${stillMissing.join(', ')}.\n`
      + `Newly-created packages can lag on first publish. This is NOT proof of a failed publish; `
      + `re-check with 'npm view <pkg>@alpha version', or re-run 'pnpm run release:alpha:publish' `
      + `(already-published versions are skipped).`
    );
  }
  return stillMissing.length === 0;
}

const rootDir = process.cwd();
const options = parseArgs(process.argv);

console.log('Jess alpha release orchestrator');
console.log(`Mode: ${options.dryRun ? 'dry-run' : 'ship'}`);

const branch = getCurrentBranch(rootDir);
if (branch !== 'alpha' && !options.dryRun) {
  throw new Error(`Release must run from branch 'alpha'. Current branch: '${branch}'.`);
}
if (branch !== 'alpha' && options.dryRun) {
  console.log(`Dry-run note: running from '${branch}' branch; shipping mode requires 'alpha'.`);
}

if (!options.dryRun) {
  // Check npm auth early so we don't waste time on checks/versioning only to fail at publish
  const whoami = spawnSync('npm', ['whoami'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (whoami.status !== 0) {
    console.log('\nnpm is not authenticated. Running `npm login`...\n');
    const login = spawnSync('npm', ['login'], {
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });
    if (login.status !== 0) {
      throw new Error('npm login failed. Cannot publish without authentication.');
    }
  }
  assertReadyWorkingTree(rootDir);
}

if (options.skipCheck) {
  console.log('\nSkipping preflight suite (--skip-check); assuming the current tree is already verified.');
} else {
  run('pnpm', ['run', 'release:alpha:check'], rootDir);
}

let resolution = null;
if (!options.skipVersion) {
  // Intent-first, registry-guarded version resolution replaces manual bumping:
  // resolve ONE lockstep version for the whole allowlist that is guaranteed
  // fresh (unpublished) for every package, then apply it lockstep. No
  // --skip-version / manual manifest edit is required for a normal release.
  const { plan: versionPlan } = getReleaseState(rootDir);
  resolution = resolveAlphaPublishVersion({ rootDir, plan: versionPlan });
  console.log(`\nResolved lockstep alpha version: ${resolution.resolved}`);
  console.log(
    `  intended=${resolution.intended}, `
    + `publishedMax=${resolution.publishedMax ?? '(none)'}, reason=${resolution.reason}`
  );
  if (!options.dryRun) {
    const applied = applyLockstepVersion(rootDir, resolution.resolved);
    if (applied.changed.length > 0) {
      console.log(`  Applied ${resolution.resolved} to ${applied.changed.length} workspace manifest(s).`);
      run('pnpm', ['install', '--lockfile-only'], rootDir);
    } else {
      console.log(`  Manifests already at ${resolution.resolved}.`);
    }
  }
} else {
  console.log('\nSkipping version resolution (--skip-version); using manifest versions as-is.');
}

const { plan, version: manifestVersion } = getReleaseState(rootDir);
// In dry-run we do not mutate manifests, so surface the RESOLVED version rather
// than the raw (possibly stale) manifest version.
const version = resolution?.resolved ?? manifestVersion;
const tag = `v${version}`;

if (options.dryRun) {
  console.log(`\nDry-run summary:`);
  console.log(`- Resolved alpha version: ${version}`);
  console.log(`- Planned tag: ${tag}`);
  const dryPublishArgs = [path.join(rootDir, 'scripts/release/publish-alpha.mjs'), '--dry-run', '--tag', 'alpha'];
  if (options.setLatest) dryPublishArgs.push('--set-latest');
  run('node', dryPublishArgs, rootDir);
  process.exit(0);
}

run('git', ['add', '-A'], rootDir);
const stagedChanges = spawnSync('git', ['diff', '--cached', '--quiet'], {
  cwd: rootDir,
  shell: process.platform === 'win32'
});
if (stagedChanges.status !== 0) {
  run('git', ['commit', '-m', `chore(release): alpha ${tag}`], rootDir);
} else {
  console.log('\nNo releasable file changes to commit after versioning step.');
}

if (!tagExists(rootDir, tag)) {
  run('git', ['tag', '-a', tag, '-m', `Release ${tag}`], rootDir);
} else {
  console.log(`\nTag ${tag} already exists; reusing existing tag.`);
}

if (!options.noPush) {
  run('git', ['push', 'origin', 'alpha'], rootDir);
  run('git', ['push', 'origin', tag], rootDir);
} else {
  console.log('\nSkipping git push due to --no-push');
}

if (!options.skipPublish) {
  // Forward the gated latest-tag opt-in across the `pnpm run` boundary via env
  // (inherited by the child publish-alpha process).
  if (options.setLatest) {
    process.env.ALPHA_SET_LATEST = '1';
    console.log(
      `\nNote: --set-latest is ON; the npm 'latest' dist-tag will be moved to ${version} `
      + `for every allowlisted package (relaxes the "non-alpha tags only from main" policy).`
    );
  }
  run('pnpm', ['run', 'release:alpha:publish'], rootDir);
  smokeCheck(plan, version);
} else {
  console.log('\nSkipping publish due to --skip-publish');
}

console.log('\nAlpha release flow complete.');
