import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { PluginInterface } from '@jesscss/core';
import { remoteImportPlugin } from '@jesscss/plugin-remote-import';
import { getExpectedOutputFiles, type OutputTestConfig } from '../src/config.js';
import type { StylesConfig } from 'styles-config';

export interface TestCase {
  expectedFile: string;
  config: Partial<StylesConfig>;
}

export type NumericLike = {
  value?: number | { number?: number };
  valueOf?: () => unknown;
};

export type StringLike = {
  value?: string | { value?: string };
  valueOf?: () => unknown;
};

export const lessHarnessFunctionsPlugin = {
  install(less: {
    functions: {
      functionRegistry: {
        addMultiple(functions: Record<string, (...args: unknown[]) => unknown>): void;
      };
    };
  }) {
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
};

export function readNumericFunctionArg(value: NumericLike): number {
  if (typeof value?.value === 'number') {
    return value.value;
  }
  if (typeof value?.value === 'object' && typeof value.value.number === 'number') {
    return value.value.number;
  }
  const primitive = value?.valueOf?.() ?? value;
  return Number(primitive);
}

export function readStringFunctionArg(value: StringLike): string {
  if (typeof value?.value === 'string') {
    return value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  if (typeof value?.value === 'object' && typeof value.value.value === 'string') {
    return value.value.value.replace(/^(['"])(.*)\1$/, '$2');
  }
  const primitive = value?.valueOf?.() ?? value;
  return String(primitive).replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * Get test cases for a LESS file based on output configuration.
 *
 * Logic:
 * 1. If output config is specified and the output file exists → use that file with that config
 * 2. If output config is specified but the output file doesn't exist → fall back to {name}.css with merged config options
 * 3. If no files exist at all → throw an error
 *
 * @param lessFilePath - Path to the LESS file
 * @param goldenPath - Where the corpus keeps the `{name}.css` golden, when that
 *   is not next to the `.less`
 * @returns Array of test cases, each with expected file and config to use
 */
export function getTestCases(lessFilePath: string, goldenPath?: string): TestCase[] {
  const dir = path.dirname(lessFilePath);
  const name = path.basename(lessFilePath, path.extname(lessFilePath));
  const siblingCssPath = path.join(dir, `${name}.css`);
  const defaultCssPath = goldenPath ?? siblingCssPath;

  const outputConfigs = getExpectedOutputFiles(lessFilePath);
  const configs: OutputTestConfig[] = Array.isArray(outputConfigs) ? outputConfigs : [outputConfigs];

  const testCases: TestCase[] = [];

  for (const outputConfig of configs) {
    // Check if the specified output file exists
    if (fs.existsSync(outputConfig.file)) {
      testCases.push({
        expectedFile: outputConfig.file,
        config: outputConfig.config
      });
    } else if (outputConfig.file !== siblingCssPath) {
      throw new Error(`Expected output file ${outputConfig.file} does not exist`);
    } else if (fs.existsSync(defaultCssPath)) {
      // Fall back to {name}.css with merged config options; only add if we haven't already added this exact test case
      const alreadyAdded = testCases.some(
        tc => tc.expectedFile === defaultCssPath
          && JSON.stringify(tc.config) === JSON.stringify(outputConfig.config)
      );
      if (!alreadyAdded) {
        testCases.push({
          expectedFile: defaultCssPath,
          config: outputConfig.config
        });
      }
    }

    // If default doesn't exist either, we'll check at the end
  }

  // If no test cases were found, check if default exists
  if (testCases.length === 0) {
    if (fs.existsSync(defaultCssPath)) {
      // No output config or all output files missing, but default exists
      testCases.push({
        expectedFile: defaultCssPath,
        config: {}
      });
    }
  }

  if (testCases.length === 0) {
    throw new Error(`No expected output CSS found for ${lessFilePath}`);
  }

  return testCases;
}

const require = createRequire(import.meta.url);

/**
 * The `output.sourceMap` the upstream less.js harness renders a corpus fixture
 * with (`packages/less/test/less-test.js`): an object-form, non-inline
 * `sourceMap` gets `sourceMapOutputFilename: '<fixture path>.css'` and
 * `sourceMapRootpath: 'testweb/'` wherever the fixture leaves them falsy. The
 * goldens' `sourceMappingURL` annotations were generated under that convention.
 * Returns undefined when the fixture's own config needs no override.
 */
export function upstreamHarnessSourceMap(
  relativeLessPath: string,
  sourceMap: unknown
): Record<string, unknown> | undefined {
  if (sourceMap === null || typeof sourceMap !== 'object') {
    return undefined;
  }
  const options: Record<string, unknown> = { ...sourceMap };
  if (!options.sourceMapFileInline) {
    if (!options.sourceMapOutputFilename) {
      options.sourceMapOutputFilename = relativeLessPath.replace(/\.less$/, '.css');
    }
    if (!options.sourceMapRootpath) {
      options.sourceMapRootpath = 'testweb/';
    }
  }
  return options;
}

/**
 * The token that starts at a 0-based column of one line. Only a column inside
 * the line's leading indentation may skip whitespace to reach it.
 */
export function tokenAt(line: string, col0: number): string {
  const rest = /^\s*$/u.test(line.slice(0, col0)) ? line.slice(col0).trimStart() : line.slice(col0);
  return /^(?:[.#@]?[-\w%]+|\S)/u.exec(rest)?.[0] ?? '';
}

/**
 * Why a decoded mapping is correct, or `undefined` when it points anywhere else.
 * Every kind is judged at the EXACT columns on both sides:
 *   - `token`: the token at the generated column is the token at the authored one;
 *   - `computed-value`: both columns open a declaration value (the text before
 *     each ends in `:`) and the authored value is an expression — `@var`, `$var`,
 *     `~"…"`, `(…)`, `fn(…)` — so the output is its result, not its spelling;
 *   - `rule-header`: both columns open a rule header (at a line start, or right
 *     after `{`, `}` or `;`, running to `{` or to a trailing `,`), where a
 *     flattened or `&`-composed header leads with an inherited parent rather
 *     than the authored token.
 */
export type MappingKind = 'token' | 'computed-value' | 'rule-header';

const opensHeader = (line: string, col: number): boolean =>
  /(?:^|[{};])\s*$/u.test(line.slice(0, col)) && /^[^{};]*(?:\{|,\s*$)/u.test(line.slice(col));

export function mappingKind(gen: string, genCol: number, src: string, srcCol: number): MappingKind | undefined {
  const token = tokenAt(gen, genCol);
  if (token !== '' && token === tokenAt(src, srcCol)) {
    return 'token';
  }
  if (/:\s*$/u.test(gen.slice(0, genCol)) && /:\s*$/u.test(src.slice(0, srcCol))
    && /^\s*(?:[@$~(]|[-\w]+\()/u.test(src.slice(srcCol))) {
    return 'computed-value';
  }
  return opensHeader(gen, genCol) && opensHeader(src, srcCol) ? 'rule-header' : undefined;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode a v3 `mappings` string into absolute
 * `[genLine0, genCol0, sourceIndex, sourceLine0, sourceCol0]` segments.
 * Self-contained, so a test never trusts the encoder it is checking.
 */
export function decodeSourceMapMappings(mappings: string): number[][] {
  const out: number[][] = [];
  let srcIdx = 0;
  let srcLine = 0;
  let srcCol = 0;
  mappings.split(';').forEach((line, genLine) => {
    let genCol = 0;
    if (line === '') {
      return;
    }
    for (const seg of line.split(',')) {
      const nums: number[] = [];
      let shift = 0;
      let value = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) << shift;
        if (d & 32) {
          shift += 5;
        } else {
          const magnitude = value >> 1;
          nums.push(value & 1 ? -magnitude : magnitude);
          value = 0;
          shift = 0;
        }
      }
      genCol += nums[0]!;
      if (nums.length >= 4) {
        srcIdx += nums[1]!;
        srcLine += nums[2]!;
        srcCol += nums[3]!;
        out.push([genLine, genCol, srcIdx, srcLine, srcCol]);
      }
    }
  });
  return out;
}

/**
 * Resolves the upstream Less.js test-data directory in normal installs,
 * linked workspace installs, and isolated git worktrees.
 */
export function resolveLessTestDataRoot(): string {
  const envRoot = existingDirectory(process.env.LESS_TEST_DATA_ROOT);
  if (envRoot) {
    return envRoot;
  }
  try {
    return path.dirname(require.resolve('@less/test-data'));
  } catch {
    // Continue to workspace and checkout fallbacks below.
  }
  try {
    const rootRequire = createRequire(path.join(process.cwd(), 'package.json'));
    return path.dirname(rootRequire.resolve('@less/test-data'));
  } catch {
    // Continue to checkout fallbacks below.
  }
  const checkoutRoot = gitCommonRepoRoot();
  const checkoutCandidates = [
    path.resolve(process.cwd(), '../less.js/packages/test-data'),
    checkoutRoot ? path.resolve(checkoutRoot, '../less.js/packages/test-data') : undefined
  ];
  for (const candidate of checkoutCandidates) {
    const resolved = existingDirectory(candidate);
    if (resolved) {
      return resolved;
    }
  }
  throw new Error(
    'Unable to resolve @less/test-data. Set LESS_TEST_DATA_ROOT to the Less.js packages/test-data directory.'
  );
}

/**
 * Install root for third-party packages that corpus fixtures `@import` by bare
 * specifier (e.g. `tests-config/3rd-party/bootstrap4.less` →
 * `@import "bootstrap-less-port/less/bootstrap"`). Versions there are pinned to
 * whatever the maintained `.css` golden was generated against.
 */
export function resolveLessFixtureDepsRoot(): string {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(testDir, '../../less-corpus-fixture-deps');
}

function pinnedFixturePackageDirs(): Map<string, string> {
  const depsRoot = resolveLessFixtureDepsRoot();
  const depsRequire = createRequire(path.join(depsRoot, '__jess_fixture_resolve__.js'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(depsRoot, 'package.json'), 'utf8')
  ) as { dependencies?: Record<string, string> };
  const dirs = new Map<string, string>();
  for (const name of Object.keys(manifest.dependencies ?? {})) {
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
export function lessFixturePackagesPlugin(): PluginInterface {
  const pinned = pinnedFixturePackageDirs();

  return {
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
  };
}

/**
 * The opt-in remote-import plugin, allowing `cdn.jsdelivr.net`, with its
 * transport routed to the local test-data checkout: a request for
 * `https://cdn.jsdelivr.net/npm/@less/test-data/<file>` is answered with `<file>`
 * under `testDataRoot`, anything else with a 404. Corpus fixtures that import
 * the published test-data over https (`tests-unit/import/import-remote.less`)
 * so run the real claim → locate → fetch → parse path without a network.
 */
export function lessTestDataRemoteImports(testDataRoot: string): PluginInterface {
  const published = '/npm/@less/test-data/';
  return remoteImportPlugin({
    allow: ['cdn.jsdelivr.net'],
    fetch: async (url) => {
      const { pathname } = new URL(url);
      const file = pathname.startsWith(published) ? path.join(testDataRoot, pathname.slice(published.length)) : undefined;
      return file !== undefined && fs.existsSync(file)
        ? new Response(fs.readFileSync(file, 'utf8'))
        : new Response('not found', { status: 404 });
    }
  });
}

export class FixtureTimeoutError extends Error {
  constructor(file: string, reason: string) {
    super(`${file} timed out before surfacing a diagnostic or render result: ${reason}.`);
    this.name = 'FixtureTimeoutError';
  }
}

export type FixtureBudget = {
  /** CPU the fixture may burn without settling: catches runaway work. */
  cpuMs: number;

  /** Wall time the fixture may sit unsettled: catches a promise nothing settles, which burns no CPU. */
  wallMs: number;
};

/**
 * The corpus hang sentinel: rejects with `FixtureTimeoutError` when `work` runs
 * away or stalls, so a hang fails the fixture by name instead of passing as an
 * expected failure.
 *
 * Runaway work is measured in CPU time, not wall time, because wall time is
 * mostly machine load: bootstrap4.less renders in about 1.5 s alone and blew a
 * 4.5 s wall budget whenever the ratchet ran it beside other suites. Load stops
 * the process from running; it does not make the process burn more CPU. The
 * stalled case burns none, so it keeps a wall ceiling, set under vitest's 30 s
 * `testTimeout` so this error, which names the fixture, fires first.
 *
 * `process.cpuUsage()` is the fixture's own CPU because vitest's default `forks`
 * pool runs each test file in its own process, one test at a time.
 */
export async function withFixtureTimeout<T>(
  file: string,
  work: () => Promise<T>,
  budget: FixtureBudget = { cpuMs: 4500, wallMs: 25_000 }
): Promise<T> {
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  let poll: ReturnType<typeof setInterval> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    poll = setInterval(() => {
      const { user, system } = process.cpuUsage(cpuStart);
      const cpuMs = (user + system) / 1000;
      if (cpuMs > budget.cpuMs) {
        reject(new FixtureTimeoutError(file, `it burned ${Math.round(cpuMs)} ms of CPU, over its ${budget.cpuMs} ms budget`));
      } else if (performance.now() - wallStart > budget.wallMs) {
        reject(new FixtureTimeoutError(file, `it was still unsettled after ${budget.wallMs} ms`));
      }
    }, 25);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearInterval(poll);
  }
}

function existingDirectory(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  const resolved = path.resolve(value);
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return;
  }
}

function gitCommonRepoRoot(): string | undefined {
  try {
    const output = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    }).trim();
    return path.dirname(output);
  } catch {
    return;
  }
}
