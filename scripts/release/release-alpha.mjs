#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getAlphaReleasePlan, incrementAlphaVersions } from './release-utils.mjs';

function parseArgs(argv) {
  const options = {
    dryRun: false,
    noPush: false,
    skipVersion: false,
    skipPublish: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    if (arg === '--no-push') options.noPush = true;
    if (arg === '--skip-version') options.skipVersion = true;
    if (arg === '--skip-publish') options.skipPublish = true;
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
  const dirty = getDirtyFiles(rootDir).filter(file => !file.startsWith('.cursor/'));
  if (dirty.length > 0) {
    throw new Error(
      `Working tree is not clean. Commit or stash non-.cursor changes first:\n- ${dirty.join('\n- ')}`
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

function smokeCheck(plan, expectedVersion) {
  console.log('\nNPM alpha tag smoke check:');
  for (const pkgName of plan.allowlist) {
    const result = spawnSync('npm', ['view', `${pkgName}@alpha`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });
    const raw = (result.stdout ?? '').trim();
    const displayed = raw || '(not found)';
    console.log(`- ${pkgName}@alpha => ${displayed}`);
  }
  console.log(`\nExpected published version: ${expectedVersion}`);
}

function getNpmAlphaVersion(pkgName) {
  const result = spawnSync('npm', ['view', `${pkgName}@alpha`, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) return null;
  const raw = (result.stdout ?? '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return raw || null;
  }
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

run('pnpm', ['run', 'release:alpha:check'], rootDir);

if (!options.skipVersion) {
  // Guard against double-increment: if a previous run already bumped the version
  // but failed before publishing, don't bump again.
  const { version: localVersion } = getReleaseState(rootDir);
  const npmVersion = getNpmAlphaVersion(getAlphaReleasePlan({ rootDir }).allowlist[0]);
  if (npmVersion && localVersion !== npmVersion) {
    console.log(`\nVersion already incremented (local: ${localVersion}, npm: ${npmVersion}). Skipping increment.`);
  } else {
    console.log('\nAuto-incrementing alpha version...');
    const { previousVersion, nextVersion } = incrementAlphaVersions({ rootDir });
    console.log(`  ${previousVersion} -> ${nextVersion}`);
    run('pnpm', ['install', '--lockfile-only'], rootDir);
  }
}

const { plan, version } = getReleaseState(rootDir);
const tag = `v${version}`;

if (options.dryRun) {
  console.log(`\nDry-run summary:`);
  console.log(`- Next alpha version: ${version}`);
  console.log(`- Planned tag: ${tag}`);
  run('node', [path.join(rootDir, 'scripts/release/publish-alpha.mjs'), '--dry-run', '--tag', 'alpha'], rootDir);
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
  run('pnpm', ['run', 'release:alpha:publish'], rootDir);
  smokeCheck(plan, version);
} else {
  console.log('\nSkipping publish due to --skip-publish');
}

console.log('\nAlpha release flow complete.');
