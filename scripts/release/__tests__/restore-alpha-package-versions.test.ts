import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { preserveRecoveryManifestVersion } from '../release-utils.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' });
}

function writeManifest(root: string, manifest: object, packagePath = 'fixture'): string {
  const packageDir = path.join(root, 'packages', packagePath);
  mkdirSync(packageDir, { recursive: true });
  const packageJson = path.join(packageDir, 'package.json');
  writeFileSync(packageJson, `${JSON.stringify(manifest, null, 2)}\n`);
  return packageJson;
}

describe('preserveRecoveryManifestVersion', () => {
  it('takes only version from recovery and retains every imported manifest field', () => {
    const imported = {
      name: '@jesscss/less-parser',
      version: '2.0.0-alpha.5',
      exports: { root: './lib/index.js' },
      peerDependencies: { parseman: '^0.28.1' },
      devDependencies: { parseman: '0.28.1' }
    };
    const recovery = {
      name: '@jesscss/less-parser',
      version: '2.0.0-alpha.9',
      peerDependencies: { parseman: '^0.28.0' }
    };

    expect(preserveRecoveryManifestVersion(imported, recovery)).toEqual({
      ...imported,
      version: '2.0.0-alpha.9'
    });
  });

  it('rejects recovery manifests without a usable version', () => {
    expect(() =>
      preserveRecoveryManifestVersion({ name: 'x' }, { name: 'x' })).toThrow(/non-empty string version/);
  });

  it('requires --stage so restored versions cannot be left outside the snapshot index', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'jess-alpha-restore-'));
    temporaryRoots.push(root);
    writeManifest(root, { name: '@fixture/package', version: '2.0.0-alpha.9' });
    run('git', ['init', '--quiet'], root);
    run('git', ['config', 'user.email', 'test@example.invalid'], root);
    run('git', ['config', 'user.name', 'Release Test'], root);
    run('git', ['add', '.'], root);
    run('git', ['commit', '--quiet', '-m', 'recovery'], root);

    writeManifest(root, {
      name: '@fixture/package', version: '2.0.0-alpha.5',
      exports: { ['.']: './lib/index.js' }
    });
    run('git', ['add', '.'], root);

    const script = path.resolve('scripts/release/restore-alpha-package-versions.mjs');
    const missingStage = spawnSync(process.execPath, [script, '--from', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    });
    expect(missingStage.status).not.toBe(0);
    expect(missingStage.stderr).toMatch(/Missing required --stage/u);

    const restored = spawnSync(process.execPath, [script, '--from', 'HEAD', '--stage'], {
      cwd: root,
      encoding: 'utf8'
    });
    expect(restored.status).toBe(0);
    expect(restored.stdout).toMatch(/Preserved and staged recovery alpha versions/u);

    const staged = JSON.parse(run('git', ['show', ':packages/fixture/package.json'], root));
    expect(staged).toEqual({
      name: '@fixture/package',
      version: '2.0.0-alpha.9',
      exports: { ['.']: './lib/index.js' }
    });
    expect(run('git', ['diff', '--', 'packages/fixture/package.json'], root)).toBe('');
  });

  it('keeps imported versions for packages added after the recovery ref', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'jess-alpha-restore-new-'));
    temporaryRoots.push(root);
    writeManifest(root, { name: '@fixture/package', version: '2.0.0-alpha.10' });
    run('git', ['init', '--quiet'], root);
    run('git', ['config', 'user.email', 'test@example.invalid'], root);
    run('git', ['config', 'user.name', 'Release Test'], root);
    run('git', ['add', '.'], root);
    run('git', ['commit', '--quiet', '-m', 'recovery'], root);

    writeManifest(root, {
      name: '@fixture/package',
      version: '2.0.0-alpha.5',
      exports: { ['.']: './lib/index.js' }
    });
    writeManifest(root, {
      name: '@fixture/new',
      version: '2.0.0-alpha.5',
      exports: { ['.']: './lib/index.js' }
    }, 'new');
    run('git', ['add', '.'], root);

    const script = path.resolve('scripts/release/restore-alpha-package-versions.mjs');
    const restored = spawnSync(process.execPath, [script, '--from', 'HEAD', '--stage'], {
      cwd: root,
      encoding: 'utf8'
    });

    expect(restored.status).toBe(0);
    expect(restored.stdout).toMatch(/packages\/new\/package\.json: new in imported source; keeping 2\.0\.0-alpha\.5/u);
    expect(restored.stdout).toMatch(/Preserved and staged recovery alpha versions in 1 package manifest/u);

    expect(JSON.parse(run('git', ['show', ':packages/fixture/package.json'], root))).toEqual({
      name: '@fixture/package',
      version: '2.0.0-alpha.10',
      exports: { ['.']: './lib/index.js' }
    });
    expect(JSON.parse(run('git', ['show', ':packages/new/package.json'], root))).toEqual({
      name: '@fixture/new',
      version: '2.0.0-alpha.5',
      exports: { ['.']: './lib/index.js' }
    });
  });
});
