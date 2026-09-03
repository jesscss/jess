import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { preflightTreeIdentity, readPreflightMarker, writePreflightMarker } from '../release-utils.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jess-preflight-marker-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

describe('release preflight marker', () => {
  it('names a clean tree by HEAD and matches a marker written for it', () => {
    const root = repo();
    const head = git(root, 'rev-parse', 'HEAD');
    expect(preflightTreeIdentity(root)).toBe(head);
    expect(readPreflightMarker(root)).toBeNull();
    writePreflightMarker(root, head);
    expect(readPreflightMarker(root)?.identity).toBe(head);
  });

  it('gives a tree with source changes no identity, so a stale marker never matches', () => {
    const root = repo();
    writePreflightMarker(root, git(root, 'rev-parse', 'HEAD'));
    writeFileSync(path.join(root, 'a.txt'), 'changed\n');
    expect(preflightTreeIdentity(root)).toBeNull();
    git(root, 'commit', '-q', '-am', 'change');
    expect(preflightTreeIdentity(root)).not.toBe(readPreflightMarker(root)?.identity);
  });
});
