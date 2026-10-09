#!/usr/bin/env node
/**
 * Type-check `@jesscss/core`'s published declarations exactly as a consumer
 * does: from the packed tarball, in an empty project outside the workspace,
 * with `skipLibCheck` off and no ambient `@types`. The consumer imports every
 * `exports` entry point, and the program also includes every shipped `.d.ts`,
 * so a declaration no entry point reaches today cannot hide a broken import.
 *
 * Every one of those conditions is load-bearing. Inside the workspace, a
 * declaration that imports a package core does not depend on (a
 * devDependency, a root-only tool, `@types/node` globals) still resolves
 * through the workspace's own `node_modules`, and `skipLibCheck` hides every
 * error inside `.d.ts` files. The previous version of this check had both
 * blind spots and passed while every consumer saw "Cannot find module
 * 'chevrotain'".
 *
 * Core's workspace dependencies are packed alongside it, so the consumer never
 * resolves an unpublished version from the registry. Third-party dependencies
 * install from the registry, as they do for a real consumer.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeWorkspaceDeps, listWorkspacePackages } from './release/release-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = '@jesscss/core';
const keep = process.argv.includes('--keep');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32'
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function runOrThrow(command, args, cwd) {
  const result = run(command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(' ')} failed:\n${result.stdout}${result.stderr}`);
  }
  return result;
}

/** The target and every workspace package it depends on at runtime. */
function workspaceClosure(workspace, name) {
  const closure = new Map();
  const pending = [name];
  while (pending.length > 0) {
    const next = pending.pop();
    if (closure.has(next)) {
      continue;
    }
    const pkg = workspace.get(next);
    if (!pkg) {
      throw new Error(`${next} is not a workspace package.`);
    }
    closure.set(next, pkg);
    pending.push(...getRuntimeWorkspaceDeps(pkg.manifest));
  }
  return [...closure.values()];
}

/** Every importable subpath of the package's `exports` map, as specifiers. */
function publicSpecifiers(manifest) {
  return Object.keys(manifest.exports)
    .filter(subpath => !subpath.endsWith('.json'))
    .map(subpath => subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`);
}

const PREPARED_IMPORTS_ASSERTIONS = `
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
`;

function main() {
  const workspace = listWorkspacePackages(root);
  const target = workspace.get(TARGET);
  const temp = mkdtempSync(path.join(os.tmpdir(), 'jess-core-public-types-'));
  const packDir = path.join(temp, 'packs');
  const consumerDir = path.join(temp, 'consumer');
  try {
    mkdirSync(packDir);
    mkdirSync(consumerDir);

    const dependencies = {};
    for (const pkg of workspaceClosure(workspace, TARGET)) {
      const packed = runOrThrow('pnpm', ['pack', '--json', '--pack-destination', packDir], pkg.dir);
      dependencies[pkg.name] = `file:${JSON.parse(packed.stdout).filename}`;
    }
    writeFileSync(path.join(consumerDir, 'package.json'), `${JSON.stringify({
      name: 'jess-core-public-types-consumer',
      private: true,
      type: 'module',
      dependencies
    }, null, 2)}\n`);
    runOrThrow('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--prefer-offline'], consumerDir);

    const specifiers = publicSpecifiers(target.manifest);
    writeFileSync(path.join(consumerDir, 'consumer.ts'), [
      ...specifiers.map((specifier, index) => `import * as entry${index} from '${specifier}';`),
      `export { ${specifiers.map((_, index) => `entry${index}`).join(', ')} };`,
      PREPARED_IMPORTS_ASSERTIONS
    ].join('\n'));
    writeFileSync(path.join(consumerDir, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',

        /*
         * No ambient @types: a transitive dependency that installs @types/node
         * must not hide a Node global leaking into core's declarations.
         */
        types: []
      },
      include: [
        'consumer.ts',
        ...target.manifest.files.map(entry => `node_modules/${TARGET}/${entry}/**/*.d.ts`)
      ],

      /* The default exclude is node_modules, which would drop the shipped files. */
      exclude: []
    }, null, 2)}\n`);

    /*
     * The workspace-pinned compiler, run from the consumer so that no module
     * resolution or type root walks back into the workspace.
     */
    const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
    const result = run(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], consumerDir);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) {
      console.error(`\nCore public type consumer verification failed (${specifiers.join(', ')}).`);
      process.exitCode = result.status ?? 1;
      return;
    }
    console.log(`Core public type consumer verification passed (${specifiers.join(', ')}).`);
  } finally {
    if (keep) {
      console.log(`Kept consumer fixture: ${temp}`);
    } else {
      rmSync(temp, { recursive: true, force: true });
    }
  }
}

main();
