#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getAlphaReleasePlan } from './release-utils.mjs';

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    tag: 'alpha'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--tag' && argv[i + 1]) {
      parsed.tag = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--tag=')) {
      parsed.tag = arg.slice('--tag='.length);
      continue;
    }
  }
  return parsed;
}

function run(command, args, cwd) {
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

function currentBranch() {
  const envBranch = process.env.GITHUB_REF_NAME?.trim();
  if (envBranch) {
    return envBranch;
  }
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    throw new Error('Unable to determine git branch for publish policy checks.');
  }
  return (result.stdout ?? '').trim();
}

function packageVersionExists(pkgName, version) {
  const query = `${pkgName}@${version}`;
  const result = spawnSync('npm', ['view', query, 'version', '--json'], {
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

function getTaggedVersion(pkgName, tag) {
  const result = spawnSync('npm', ['view', `${pkgName}@${tag}`, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    return null;
  }

  const output = (result.stdout ?? '').trim();
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (Array.isArray(parsed)) {
      return parsed.at(-1) ?? null;
    }
    return null;
  } catch {
    return output;
  }
}

function assertNpmAuth() {
  const result = spawnSync('npm', ['whoami'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    console.error('\nnpm is not authenticated. Run `npm login` to sign in, then retry.');
    console.error('For CI, set NPM_TOKEN in the environment.\n');
    process.exit(1);
  }
}

const options = parseArgs(process.argv);
const rootDir = process.cwd();
const allowlistPath = path.join(rootDir, 'scripts/release/alpha-allowlist.json');
const branch = currentBranch();

if (!options.dryRun) {
  assertNpmAuth();
}

if (options.tag === 'alpha') {
  if (branch !== 'alpha') {
    if (!options.dryRun) {
      console.error(
        `Refusing publish: npm tag 'alpha' can only be published from branch 'alpha' (current: '${branch}').`
      );
      process.exit(1);
    }
    console.log(`Dry-run note: alpha publish policy requires branch 'alpha' (current: '${branch}').`);
  }
}

if (options.tag !== 'alpha' && !options.dryRun && branch !== 'main') {
  console.error(
    `Refusing publish: non-alpha npm tags can only be published from branch 'main' (current: '${branch}').`
  );
  process.exit(1);
}

const plan = getAlphaReleasePlan({ rootDir, allowlistPath });
if (plan.errors.length > 0) {
  console.error('Refusing publish due to allowlist validation errors:');
  for (const error of plan.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const lockstepVersion = plan.packages[0]?.manifest.version ?? '';
if (options.tag === 'alpha' && lockstepVersion && !lockstepVersion.includes('-alpha.')) {
  console.error(
    `Refusing publish: allowlisted package version '${lockstepVersion}' does not include '-alpha.' while publishing with --tag alpha.`
  );
  process.exit(1);
}

if (options.tag !== 'alpha' && lockstepVersion.includes('-alpha.')) {
  console.error(
    `Refusing publish: version '${lockstepVersion}' includes '-alpha.' and cannot be published with non-alpha tag '${options.tag}'.`
  );
  process.exit(1);
}

console.log(
  `${options.dryRun ? 'Dry-run' : 'Publishing'} ${plan.publishOrder.length} allowlisted package(s) with npm tag '${options.tag}'.`
);

if (!options.dryRun) {
  for (const pkgName of plan.publishOrder) {
    const pkg = plan.packagesByName.get(pkgName);
    if (pkg.manifest.scripts?.build) {
      console.log(`\nBuilding ${pkgName}...`);
      run('pnpm', ['--filter', pkgName, 'run', 'build'], rootDir);
    }
  }
}

for (const pkgName of plan.publishOrder) {
  const pkg = plan.packagesByName.get(pkgName);
  const version = pkg.manifest.version;
  const publishArgs = ['publish', '--tag', options.tag, '--no-git-checks', '--ignore-scripts'];
  const access = pkg.manifest.publishConfig?.access;
  if (access) {
    publishArgs.push('--access', access);
  }
  if (options.dryRun) {
    publishArgs.push('--dry-run');
  }

  const taggedVersion = getTaggedVersion(pkgName, options.tag);
  const versionExists = packageVersionExists(pkgName, version);

  if (versionExists) {
    if (taggedVersion === version) {
      console.log(`\nSkipping ${pkgName}@${version}: ${options.tag} already points to that version.`);
      continue;
    }

    console.log(
      `\n${options.dryRun ? 'Dry-run note' : 'Retagging'} ${pkgName}@${version}: `
      + `${options.tag} currently points to ${taggedVersion ?? '(not found)'}`
    );

    if (!options.dryRun) {
      run('npm', ['dist-tag', 'add', `${pkgName}@${version}`, options.tag], rootDir);
    }
    continue;
  }

  console.log(`\n${options.dryRun ? 'Dry-run pack/publish check' : 'Publishing'} ${pkgName}@${version}`);
  run('pnpm', publishArgs, pkg.dir);
}

console.log(`\n${options.dryRun ? 'Dry-run checks finished.' : 'Alpha publish finished.'}`);
