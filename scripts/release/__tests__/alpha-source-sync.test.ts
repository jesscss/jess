import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const recordScript = path.join(repositoryRoot, 'scripts/release/record-alpha-source-provenance.mjs');
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

function createAlphaSandbox() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'jess-alpha-source-sync-'));
  temporaryRoots.push(tempRoot);
  const remote = path.join(tempRoot, 'origin.git');
  const source = path.join(tempRoot, 'source');
  const alpha = path.join(tempRoot, 'alpha');
  run('git', ['init', '--bare', '--quiet', remote], tempRoot);
  run('git', ['init', '--quiet', '--initial-branch=dev', source], tempRoot);
  run('git', ['config', 'user.email', 'test@example.invalid'], source);
  run('git', ['config', 'user.name', 'Release Test'], source);
  writeJson(path.join(source, 'packages/fixture/package.json'), {
    name: '@fixture/package', version: '2.0.0-alpha.5', exports: { ['.']: './lib/index.js' }
  });
  mkdirSync(path.join(source, 'src'), { recursive: true });
  writeFileSync(path.join(source, 'src/engine.mjs'), 'export const source = true;\n');
  commitAll(source, 'source');
  run('git', ['remote', 'add', 'origin', remote], source);
  run('git', ['push', '--quiet', '-u', 'origin', 'dev'], source);
  run('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/dev'], tempRoot);
  run('git', ['clone', '--quiet', remote, alpha], tempRoot);
  run('git', ['switch', '--quiet', '-c', 'alpha', '--track', 'origin/dev'], alpha);
  run('git', ['config', 'user.email', 'test@example.invalid'], alpha);
  run('git', ['config', 'user.name', 'Release Test'], alpha);

  writeJson(path.join(alpha, 'packages/fixture/package.json'), {
    name: '@fixture/package', version: '2.0.0-alpha.9', exports: { ['.']: './lib/index.js' }
  });
  commitAll(alpha, 'alpha package version');
  const record = runResult(process.execPath, [recordScript, '--stage'], alpha);
  expect(record.status).toBe(0);
  expect(record.stdout).toMatch(/Recorded and staged alpha source provenance/u);
  commitAll(alpha, 'record alpha source provenance');
  return { alpha, source };
}

describe('alpha source-sync release guard', () => {
  it('accepts a clean alpha projection with version-only package differences and exact pushed-dev provenance', () => {
    const { alpha } = createAlphaSandbox();
    const result = runResult(process.execPath, [verifyScript], alpha);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Alpha source projection verified/u);
    const provenance = JSON.parse(readFileSync(path.join(alpha, 'scripts/release/alpha-source-provenance.json'), 'utf8'));
    expect(provenance).toEqual({
      schemaVersion: 1,
      sourceRef: 'origin/dev',
      sourceCommit: run('git', ['rev-parse', 'origin/dev'], alpha).trim()
    });
  });

  it('allows a bounded pushed-dev advance after the alpha snapshot was recorded', () => {
    const { alpha, source } = createAlphaSandbox();
    writeFileSync(path.join(source, 'src/new-source.mjs'), 'export const newer = true;\n');
    commitAll(source, 'advance dev');
    run('git', ['push', '--quiet', 'origin', 'dev'], source);

    const result = runResult(process.execPath, [verifyScript], alpha);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\(1 commits ahead\)/u);
  });

  it('rejects a pushed-dev advance beyond the bounded release drift', () => {
    const { alpha, source } = createAlphaSandbox();
    for (let index = 0; index < 13; index++) {
      writeFileSync(path.join(source, 'src', `advance-${index}.mjs`), `export const advance = ${index};\n`);
      commitAll(source, `advance dev ${index}`);
    }
    run('git', ['push', '--quiet', 'origin', 'dev'], source);

    const result = runResult(process.execPath, [verifyScript], alpha);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/13 commits behind current origin\/dev/u);
    expect(result.stderr).toMatch(/maximum allowed drift is 12/u);
  });

  it('rejects any alpha-only source change', () => {
    const { alpha } = createAlphaSandbox();
    writeFileSync(path.join(alpha, 'src/engine.mjs'), 'export const source = false;\n');
    commitAll(alpha, 'alpha source divergence');

    const result = runResult(process.execPath, [verifyScript], alpha);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/outside the controlled release surface: M\tsrc\/engine\.mjs/u);
  });

  it('rejects a package manifest change that is not its version', () => {
    const { alpha } = createAlphaSandbox();
    writeJson(path.join(alpha, 'packages/fixture/package.json'), {
      name: '@fixture/package', version: '2.0.0-alpha.9', exports: { ['.']: './dist/index.js' }
    });
    commitAll(alpha, 'alpha manifest divergence');

    const result = runResult(process.execPath, [verifyScript], alpha);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/outside the controlled release surface: M\tpackages\/fixture\/package\.json/u);
  });
});
