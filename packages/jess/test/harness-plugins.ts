/**
 * The plugins the Less corpus harness configures. Each factory records itself
 * on what it makes (`recordPluginModule`), so a render that runs whole in the
 * `@jesscss/plugin-js` sandbox can make the same plugin there from this module
 * (ledger A19). Keep this module's imports lean: the sandbox imports it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { recordPluginModule, type PluginInterface } from '@jesscss/core';
import { remoteImportPlugin } from '@jesscss/plugin-remote-import';

export type NumericLike = {
  value?: number | { number?: number } | null;
  valueOf?: () => unknown;
};

export type StringLike = {
  value?: string | { value?: string } | null;
  valueOf?: () => unknown;
};

export function readNumericFunctionArg(value: NumericLike): number {
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.value === 'object' && typeof value.value?.number === 'number') {
    return value.value.number;
  }
  const primitive = value?.valueOf?.() ?? value;
  return Number(primitive);
}

export function readStringFunctionArg(value: StringLike): string {
  if (typeof value?.value === 'string') {
    return value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  if (typeof value?.value === 'object' && typeof value.value?.value === 'string') {
    return value.value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  const primitive = value?.valueOf?.() ?? value;
  return String(primitive).replace(/^(['"])(.*)\1$/, '$2');
}

type HarnessLessPlugin = {
  install(less: {
    functions: {
      functionRegistry: {
        addMultiple(functions: Record<string, (...args: unknown[]) => unknown>): void;
      };
    };
  }): void;
};

/** The upstream Less harness's function plugin (`add`, `increment`, `_color`). */
export const lessHarnessFunctions = (): HarnessLessPlugin => recordPluginModule({
  install(less) {
    less.functions.functionRegistry.addMultiple({
      add(a: NumericLike, b: NumericLike) {
        return readNumericFunctionArg(a) + readNumericFunctionArg(b);
      },
      increment(a: NumericLike) {
        return readNumericFunctionArg(a) + 1;
      },
      _color(str: StringLike) {
        if (readStringFunctionArg(str) === 'evil red') {
          return '#660000';
        }
        return undefined;
      }
    });
  }
}, import.meta.url, 'lessHarnessFunctions', []);

export function resolveLessFixtureDepsRoot(): string {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(testDir, '../../less-corpus-fixture-deps');
}

function pinnedFixturePackageDirs(): Map<string, string> {
  const depsRoot = resolveLessFixtureDepsRoot();
  const depsRequire = createRequire(path.join(depsRoot, '__jess_fixture_resolve__.js'));
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(depsRoot, 'package.json'), 'utf8'));
  const dependencies: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'dependencies') : undefined;
  const dirs = new Map<string, string>();
  for (const name of typeof dependencies === 'object' && dependencies !== null ? Object.keys(dependencies) : []) {
    dirs.set(name, path.dirname(depsRequire.resolve(`${name}/package.json`)));
  }
  return dirs;
}

/**
 * Pins the third-party packages that corpus fixtures import by bare specifier to
 * `packages/less-corpus-fixture-deps`, whatever Node's resolver would otherwise pick.
 *
 * Two things break unpinned resolution, and search paths fix neither:
 *
 * 1. The fixtures live in the read-only Less.js checkout and declare no dependencies,
 *    so Node's upward `node_modules` walk from a fixture reaches nothing installable.
 * 2. `vitest` sets `NODE_PATH` to pnpm's flat virtual store
 *    (`node_modules/.pnpm/node_modules`, which holds one copy of *every* installed
 *    package). Node consults `NODE_PATH` for every bare resolution regardless of the
 *    importing directory, so (1) silently succeeds against whichever copy is hoisted
 *    there — for `bootstrap-less-port` that is jess's own perf-test devDependency
 *    `~2.5.1`, a Bootstrap **5** port, not the `0.3.0` Bootstrap **4** port the
 *    `bootstrap4.css` golden was generated against. Adding a search path cannot win:
 *    `@jesscss/plugin-less` tries the importing directory first, and `NODE_PATH`
 *    makes that attempt succeed.
 *
 * So this resolver runs after plugin-less has expanded the specifier and re-points
 * any candidate that landed in another copy of a pinned package at the pinned one.
 */
export function lessFixturePackagesPlugin(
  pinned: ReadonlyArray<readonly [string, string]> = [...pinnedFixturePackageDirs()]
): PluginInterface {
  return recordPluginModule({
    name: 'less-corpus-fixture-packages',
    resolve(filePath: string | string[]) {
      const candidates = Array.isArray(filePath) ? filePath : [filePath];
      return candidates.map((candidate) => {
        for (const [name, dir] of pinned) {
          const marker = `${path.sep}${name}${path.sep}`;
          const at = candidate.lastIndexOf(marker);
          if (at !== -1) {
            return path.join(dir, candidate.slice(at + marker.length));
          }
          if (candidate.startsWith(`${name}/`)) {
            return path.join(dir, candidate.slice(name.length + 1));
          }
        }
        return candidate;
      });
    }
  }, import.meta.url, 'lessFixturePackagesPlugin', [pinned]);
}

/**
 * The opt-in remote-import plugin, allowing `cdn.jsdelivr.net`, with its
 * transport routed to the local test-data checkout: a request for
 * `https://cdn.jsdelivr.net/npm/@less/test-data/<file>` is answered with `<file>`
 * under `testDataRoot`, anything else with a 404.
 */
export function lessTestDataRemoteImports(testDataRoot: string): PluginInterface {
  const published = '/npm/@less/test-data/';
  return recordPluginModule(remoteImportPlugin({
    allow: ['cdn.jsdelivr.net'],
    fetch: async (url) => {
      const { pathname } = new URL(url);
      const file = pathname.startsWith(published) ? path.join(testDataRoot, pathname.slice(published.length)) : undefined;
      return file !== undefined && fs.existsSync(file)
        ? new Response(fs.readFileSync(file, 'utf8'))
        : new Response('not found', { status: 404 });
    }
  }), import.meta.url, 'lessTestDataRemoteImports', [testDataRoot]);
}

/**
 * The read root for a corpus render that runs a script: the nearest folder
 * holding both the corpus and this repository. The corpus is a sibling
 * checkout and the harness installs its fixture packages in this repository,
 * so the read root a stylesheet alone would get (ledger A19) covers neither.
 */
export function corpusReadRoot(testDataRoot: string): string {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  let dir = fs.realpathSync(testDataRoot);
  const repo = fs.realpathSync(repoRoot);
  while (path.relative(dir, repo).startsWith('..')) {
    dir = path.dirname(dir);
  }
  return dir;
}
