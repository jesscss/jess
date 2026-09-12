#!/usr/bin/env node
/*
 * Register the GitHub Actions OIDC trusted publisher for every allowlisted alpha
 * package, so `.github/workflows/publish-alpha.yml` can publish tokenlessly.
 *
 * One-time (per package) npmjs.com configuration, scripted off the allowlist so it
 * stays in sync as packages are added. Requires:
 *   - npm CLI >= 11.10.0 (the `npm trust` command), and
 *   - an authenticated npm session with publish rights (`npm whoami` must succeed).
 *
 * Usage:
 *   node scripts/release/configure-trusted-publishers.mjs            # apply
 *   node scripts/release/configure-trusted-publishers.mjs --dry-run  # preview
 *
 * Idempotent: re-registering the same publisher is a no-op on npm's side.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = 'jesscss/jess';
const WORKFLOW = 'publish-alpha.yml';
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const allowlist = JSON.parse(
  readFileSync(path.join(rootDir, 'scripts/release/alpha-allowlist.json'), 'utf8')
);

const dryRun = process.argv.includes('--dry-run');

function npmMajorMinorOk() {
  const v = spawnSync('npm', ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const m = /^(\d+)\.(\d+)/.exec(v);
  if (!m) {
    return { ok: false, version: v || '(unknown)' };
  }
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return { ok: major > 11 || (major === 11 && minor >= 10), version: v };
}

const { ok, version } = npmMajorMinorOk();
if (!ok) {
  console.error(`npm ${version} does not have the 'npm trust' command. Upgrade: npm install -g npm@latest`);
  process.exit(1);
}
if (spawnSync('npm', ['whoami'], { encoding: 'utf8' }).status !== 0) {
  console.error('Not authenticated to npm. Run `npm login` (with publish rights) first.');
  process.exit(1);
}

const failed = [];
for (const pkg of allowlist) {
  const args = ['trust', 'github', pkg, '--file', WORKFLOW, '--repo', REPO, '--allow-publish', '--yes'];
  if (dryRun) {
    args.push('--dry-run');
  }
  console.log(`\n$ npm ${args.join(' ')}`);
  if (spawnSync('npm', args, { stdio: 'inherit' }).status !== 0) {
    failed.push(pkg);
  }
}

if (failed.length > 0) {
  console.error(`\nFailed to configure ${failed.length} package(s):\n- ${failed.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nTrusted publisher (${REPO} / ${WORKFLOW}) configured for ${allowlist.length} package(s).`);
