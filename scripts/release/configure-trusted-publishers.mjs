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
 * Idempotent: a package that already has this publisher (npm E409) counts as
 * done. A package that is not on npm yet cannot be registered; it is reported
 * with the one-time manual publish it needs first.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyTrustResult, npmViewVersions } from './release-utils.mjs';

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

/* Echo npm's stderr live (it can carry an auth prompt) while keeping it to
 * recognize E409. */
function npmTrust(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { stdio: ['inherit', 'inherit', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', status => resolve({ status, output: stderr }));
  });
}

const byOutcome = { registered: [], 'already-registered': [], 'needs-first-publish': [], failed: [] };
for (const pkg of allowlist) {
  const published = npmViewVersions(pkg).length > 0;
  let result = { status: null, output: '' };
  if (published) {
    const args = ['trust', 'github', pkg, '--file', WORKFLOW, '--repo', REPO, '--allow-publish', '--yes'];
    if (dryRun) {
      args.push('--dry-run');
    }
    console.log(`\n$ npm ${args.join(' ')}`);
    result = await npmTrust(args);
  }
  const outcome = classifyTrustResult({ published, ...result });
  byOutcome[outcome].push(pkg);
  if (outcome === 'already-registered') {
    console.log(`${pkg}: already registered.`);
  }
}

const done = byOutcome.registered.length + byOutcome['already-registered'].length;
console.log(`\nTrusted publisher (${REPO} / ${WORKFLOW}): ${byOutcome.registered.length} registered, `
  + `${byOutcome['already-registered'].length} already registered (${done} of ${allowlist.length}).`);

if (byOutcome['needs-first-publish'].length > 0) {
  console.error('\nNot on npm yet, so a trusted publisher cannot be registered. Publish each once by hand '
    + '(from the alpha branch, with the release version in its package.json), then re-run this script:');
  for (const pkg of byOutcome['needs-first-publish']) {
    console.error(`  pnpm --filter ${pkg} publish --tag alpha --no-git-checks`);
  }
}
if (byOutcome.failed.length > 0) {
  console.error(`\nFailed to configure ${byOutcome.failed.length} package(s):\n- ${byOutcome.failed.join('\n- ')}`);
}
if (byOutcome['needs-first-publish'].length > 0 || byOutcome.failed.length > 0) {
  process.exit(1);
}
