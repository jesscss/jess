#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(root, 'packages/jess/.tmp-core-public-types-'));
const consumer = path.join(temp, 'consumer.ts');

writeFileSync(consumer, `
import type { PreparedImports } from '@jesscss/core';

declare const prepared: PreparedImports;

// @ts-expect-error PreparedImports has no public mutable document graph.
prepared.documents;

// @ts-expect-error Callers cannot construct the opaque token themselves.
const forged: PreparedImports = {};

// @ts-expect-error The opaque token must not expose WeakMap methods.
prepared.get;

// @ts-expect-error PreparedImports is not publicly callable.
prepared();
`);

try {
  const result = spawnSync('pnpm', [
    '-w', 'exec', 'tsc',
    '--ignoreConfig',
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    consumer
  ], {
    cwd: root,
    encoding: 'utf8'
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    console.log('Core public type consumer verification passed.');
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
