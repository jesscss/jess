import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const recordScript = path.join(repositoryRoot, 'scripts/release/record-alpha-source-provenance.mjs');
const updateScript = path.join(repositoryRoot, 'scripts/release/update-alpha-from-dev.mjs');
const verifyScript = path.join(repositoryRoot, 'scripts/release/verify-alpha-source-sync.mjs');

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8' });
}

function runResult(command: string, args: string[], cwd: string) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function writeJson(file: string, value: object) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function commitAll(root: string, message: string) {
  run('git', ['add', '.'], root);
  run('git', ['commit', '--quiet', '-m', message], root);
}

function createSandbox() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'jess-alpha-update-'));
  temporaryRoots.push(tempRoot);
  const remote = path.join(tempRoot, 'origin.git');
  const source = path.join(tempRoot, 'source');
  const alpha = path.join(tempRoot, 'alpha');
  run('git', ['init', '--bare', '--quiet', remote], tempRoot);
  run('git', ['init', '--quiet', '--initial-branch=dev', source], tempRoot);
  run('git', ['config', 'user.email', 'test@example.invalid'], source);
  run('git', ['config', 'user.name', 'Release Test'], source);

  writeJson(path.join(source, 'packages/fixture/package.json'), {
    name: '@fixture/package',
    version: '2.0.0-alpha.5',
    exports: { ['.']: './lib/index.js' }
  });
  writeJson(path.join(source, 'scripts/release/alpha-allowlist.json'), ['@fixture/package']);
  mkdirSync(path.join(source, 'src'), { recursive: true });
  writeFileSync(path.join(source, 'src/engine.mjs'), 'export const source = 1;\n');
  commitAll(source, 'source');
  run('git', ['remote', 'add', 'origin', remote], source);
  run('git', ['push', '--quiet', '-u', 'origin', 'dev'], source);
  run('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/dev'], tempRoot);

  run('git', ['clone', '--quiet', remote, alpha], tempRoot);
  run('git', ['switch', '--quiet', '-c', 'alpha', '--track', 'origin/dev'], alpha);
  run('git', ['config', 'user.email', 'test@example.invalid'], alpha);
  run('git', ['config', 'user.name', 'Release Test'], alpha);
  writeJson(path.join(alpha, 'packages/fixture/package.json'), {
    name: '@fixture/package',
    version: '2.0.0-alpha.9',
    exports: { ['.']: './lib/index.js' }
  });
  commitAll(alpha, 'alpha package version');
  const record = runResult(process.execPath, [recordScript, '--stage'], alpha);
  expect(record.status).toBe(0);
  commitAll(alpha, 'record alpha source provenance');

  return { alpha, source };
}

describe('update-alpha-from-dev release helper', () => {
  it('creates one controlled alpha snapshot from current pushed dev', () => {
    const { alpha, source } = createSandbox();
    writeJson(path.join(source, 'packages/fixture/package.json'), {
      name: '@fixture/package',
      version: '2.0.0-alpha.5',
      exports: { ['.']: './lib/index.js' },
      peerDependencies: { parseman: '^0.41.0' }
    });
    writeFileSync(path.join(source, 'src/engine.mjs'), 'export const source = 2;\n');
    commitAll(source, 'advance dev');
    run('git', ['push', '--quiet', 'origin', 'dev'], source);

    const result = runResult(process.execPath, [
      updateScript,
      '--skip-install',
      '--skip-push-check',
      '--recovery-ref',
      'alpha-pre-refresh-test'
    ], alpha);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Alpha refresh committed from origin/dev');
    expect(run('git', ['status', '--porcelain'], alpha)).toBe('');
    expect(run('git', ['log', '-1', '--pretty=%s'], alpha).trim()).toBe('chore(release): refresh alpha from dev');
    expect(run('git', ['rev-parse', '--verify', 'alpha-pre-refresh-test'], alpha).trim()).toMatch(/^[0-9a-f]{40}$/u);

    const manifest = JSON.parse(readFileSync(path.join(alpha, 'packages/fixture/package.json'), 'utf8'));
    expect(manifest).toEqual({
      name: '@fixture/package',
      version: '2.0.0-alpha.10',
      exports: { ['.']: './lib/index.js' },
      peerDependencies: { parseman: '^0.41.0' }
    });
    expect(readFileSync(path.join(alpha, 'src/engine.mjs'), 'utf8')).toBe('export const source = 2;\n');

    const provenance = JSON.parse(readFileSync(path.join(alpha, 'scripts/release/alpha-source-provenance.json'), 'utf8'));
    expect(provenance.sourceCommit).toBe(run('git', ['rev-parse', 'origin/dev'], alpha).trim());
    const verify = runResult(process.execPath, [verifyScript], alpha);
    expect(verify.status, verify.stderr).toBe(0);
  });

  it('imports a binary patch larger than the child-process default buffer', () => {
    const { alpha, source } = createSandbox();
    const largeSource = 'x'.repeat(2 * 1024 * 1024);
    writeFileSync(path.join(source, 'src/large-source.txt'), largeSource);
    commitAll(source, 'add large source');
    run('git', ['push', '--quiet', 'origin', 'dev'], source);

    const result = runResult(process.execPath, [
      updateScript,
      '--skip-install',
      '--skip-push-check',
      '--recovery-ref',
      'alpha-pre-refresh-large-patch'
    ], alpha);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(alpha, 'src/large-source.txt'), 'utf8')).toBe(largeSource);
  });

  it('refuses to run outside the alpha branch', () => {
    const { source } = createSandbox();
    const result = runResult(process.execPath, [
      updateScript,
      '--skip-install',
      '--skip-push-check'
    ], source);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Alpha refresh must run on branch \'alpha\'. Current branch: \'dev\'.');
  });
});
