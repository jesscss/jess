#!/usr/bin/env node
/**
 * Ship alpha without any pre-checks.
 * 1. Bump all allowlisted packages to target version
 * 2. pnpm install (lockfile)
 * 3. Commit and push
 * 4. Publish with --ignore-scripts (skips prepublishOnly, etc.)
 * 5. Tag and push tag
 *
 * Usage: node scripts/release/ship-alpha-no-checks.mjs [--dry-run]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getAlphaReleasePlan, incrementAlphaVersions } from './release-utils.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

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
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
  return (result.stdout ?? '').trim();
}

const rootDir = process.cwd();
const allowlistPath = path.join(rootDir, 'scripts/release/alpha-allowlist.json');
const plan = getAlphaReleasePlan({ rootDir, allowlistPath });

if (plan.errors.length > 0) {
  console.error('Allowlist validation failed:');
  plan.errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

const branch = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], rootDir);
if (branch !== 'alpha' && !DRY_RUN) {
  console.error(`Must run from branch 'alpha'. Current: ${branch}`);
  process.exit(1);
}

// Auth check (skip for dry-run)
if (!DRY_RUN) {
  const whoami = spawnSync('npm', ['whoami'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  if (whoami.status !== 0) {
    console.error('\nnpm is not authenticated. Run `npm login` first.');
    process.exit(1);
  }
}

// 1. Auto-increment alpha version
console.log('\nAuto-incrementing alpha version...');
if (DRY_RUN) {
  const currentVersion = plan.packages[0]?.manifest.version ?? 'unknown';
  console.log(`  Current: ${currentVersion} (dry-run: would increment)`);
  console.log('\nDry-run: would bump versions, then pnpm install, commit, push, publish, tag.');
  process.exit(0);
}
const { previousVersion, nextVersion: TARGET_VERSION } = incrementAlphaVersions({ rootDir });
console.log(`  ${previousVersion} -> ${TARGET_VERSION}`);

// 2. pnpm install
run('pnpm', ['install'], rootDir);

// 3. Commit and push
run('git', ['add', '-A'], rootDir);
const hasStaged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: rootDir, shell: true }).status !== 0;
if (hasStaged) {
  run('git', ['commit', '-m', `chore(release): alpha v${TARGET_VERSION}`], rootDir);
}
run('git', ['push', 'origin', 'alpha'], rootDir);

// 4. Build allowlisted packages (prepublishOnly is skipped)
for (const pkgName of plan.publishOrder) {
  const pkg = plan.packagesByName.get(pkgName);
  if (pkg.manifest.scripts?.build) {
    console.log(`\nBuilding ${pkgName}...`);
    run('pnpm', ['--filter', pkgName, 'run', 'build'], rootDir);
  }
}

// 5. Publish with --ignore-scripts
for (const pkgName of plan.publishOrder) {
  const pkg = plan.packagesByName.get(pkgName);
  const publishArgs = ['publish', '--tag', 'alpha', '--no-git-checks', '--ignore-scripts'];
  const access = pkg.manifest.publishConfig?.access;
  if (access) publishArgs.push('--access', access);
  console.log(`\nPublishing ${pkgName}@${TARGET_VERSION}`);
  run('pnpm', publishArgs, pkg.dir);
}

// 6. Tag and push
const tag = `v${TARGET_VERSION}`;
const tagExists = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
  cwd: rootDir,
  stdio: 'ignore',
  shell: true
}).status === 0;
if (!tagExists) {
  run('git', ['tag', '-a', tag, '-m', `Release ${tag}`], rootDir);
}
run('git', ['push', 'origin', tag], rootDir);

console.log(`\nDone. Published ${plan.publishOrder.length} packages as ${TARGET_VERSION}, tag ${tag} pushed.`);
