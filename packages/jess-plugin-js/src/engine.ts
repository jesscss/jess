/* eslint-disable @typescript-eslint/naming-convention -- `__jessFn` / `__jessPlugin` are the fixed engine wire tags. */
/**
 * Host-side helpers for the Deno compile engine: the read root a sandboxed
 * render runs under, and the encoding of compiler options into data the engine
 * can rebuild. Internal; not exported from the package.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JessError } from '@jesscss/core';

const realpath = (p: string): string | undefined => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return undefined;
  }
};

const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The outermost `node_modules` folder on `realPath`'s ancestor chain, or undefined. */
const outermostNodeModules = (realPath: string): string | undefined => {
  let found: string | undefined;
  for (let dir = path.dirname(realPath); path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') {
      found = dir;
    }
  }
  return found;
};

const entriesOf = (dir: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * The real paths of the entries of `dir`, whose real path is `realDir`: only a
 * link needs resolving, since any other entry's real path is `realDir` joined
 * with its name. A link that resolves nowhere is left out.
 */
const realEntries = (dir: string, realDir: string, entries: readonly fs.Dirent[]): string[] =>
  entries.flatMap((entry) => {
    const real = entry.isSymbolicLink() ? realpath(path.join(dir, entry.name)) : path.join(realDir, entry.name);
    return real === undefined ? [] : [real];
  });

/** The real paths of the packages a `node_modules` folder lists: its entries, and the entries of each `@scope` folder. */
const packageRealPaths = (nodeModules: string): string[] => {
  const realNodeModules = realpath(nodeModules);
  if (realNodeModules === undefined) {
    return [];
  }
  const entries = entriesOf(nodeModules).filter(entry => !entry.name.startsWith('.'));
  const reals = realEntries(nodeModules, realNodeModules, entries.filter(entry => !entry.name.startsWith('@')));
  for (const scope of entries.filter(entry => entry.name.startsWith('@'))) {
    const scopeDir = path.join(nodeModules, scope.name);
    const realScope = scope.isSymbolicLink() ? realpath(scopeDir) : path.join(realNodeModules, scope.name);
    if (realScope !== undefined) {
      reals.push(...realEntries(scopeDir, realScope, entriesOf(scopeDir)));
    }
  }
  return reals;
};

/**
 * Where a compile's packages really live: the nearest `node_modules` above
 * `entryDir`, then for each package it lists, the parent of the outermost
 * `node_modules` folder holding that package's real path. Under npm that is
 * the folder holding `node_modules` itself; under pnpm, whose package folders
 * link into the workspace root's `.pnpm` store, it is the workspace root. A
 * package whose real path is in no `node_modules` (a `link:` or `file:`
 * dependency) gives nothing (ledger A19).
 */
export const governingPackageRoots = (entryDir: string): string[] => {
  for (let dir = path.resolve(entryDir); ; dir = path.dirname(dir)) {
    const nodeModules = path.join(dir, 'node_modules');
    if (fs.existsSync(nodeModules)) {
      const outers = packageRealPaths(nodeModules).map(outermostNodeModules);
      return [...new Set(outers.filter((outer): outer is string => outer !== undefined).map(outer => path.dirname(outer)))];
    }
    if (path.dirname(dir) === dir) {
      return [];
    }
  }
};

const readRootCache = new Map<string, string[]>();

/**
 * The read roots of a sandboxed render (ledger A19): of the folders that hold
 * the compile's packages ({@link governingPackageRoots}), the script root
 * (`jsReadRoot`) and the entry stylesheet's folder, the ones nearest the
 * filesystem root, compared by real path. Everything under them is readable.
 * When the candidates lie on one ancestor chain that is one folder; a
 * candidate on no chain with the others (an entry beside, not inside, the
 * folder its packages live in) is kept as its own root.
 *
 * Computed with synchronous file reads: an engine started ahead of a render
 * (`prewarmEngine`) starts on this set, and the reads finish sooner than as
 * asynchronous ones queued behind the render's own.
 */
export const readRootsOf = (entryDir: string, jsReadRoot: string): string[] => {
  const key = `${entryDir}\u0000${jsReadRoot}`;
  let roots = readRootCache.get(key);
  if (roots === undefined) {
    const canonical = (dir: string) => realpath(dir) ?? path.resolve(dir);
    const candidates = [canonical(entryDir), canonical(jsReadRoot), ...governingPackageRoots(entryDir)];
    roots = candidates.filter((dir, index) =>
      !candidates.some((other, at) => at !== index && isInside(dir, other) && (dir !== other || at < index)));
    readRootCache.set(key, roots);
  }
  return roots;
};

/**
 * The `--allow-read` list for a render: each read root in its real spelling
 * and in every written spelling the render uses for it (an ancestor of the
 * entry folder or the script root whose real path it is), because Deno
 * matches paths as written; then each code directory not already under one.
 */
export const readSetFor = (entryDir: string, jsReadRoot: string, code: readonly string[]): string[] => {
  const all = readRootSpellings(entryDir, jsReadRoot);
  return [...all, ...code.filter(dir => !all.some(root => isInside(dir, root)))];
};

/** Each read root in its real spelling and in every written spelling the render uses for it (see {@link readSetFor}). */
const readRootSpellings = (entryDir: string, jsReadRoot: string): string[] => {
  const roots = readRootsOf(entryDir, jsReadRoot);
  const spellings = new Set(roots);
  for (const written of [path.resolve(entryDir), path.resolve(jsReadRoot)]) {
    const ancestors: string[] = [];
    for (let dir = written; ; dir = path.dirname(dir)) {
      ancestors.push(dir);
      if (path.dirname(dir) === dir) {
        break;
      }
    }
    ancestors.forEach((dir) => {
      const real = realpath(dir);
      if (real !== undefined && real !== dir && roots.includes(real)) {
        spellings.add(dir);
      }
    });
  }
  return [...spellings];
};

/**
 * The read roots, in each of their spellings, whose parent folder the sandbox
 * cannot read: where a config search from inside a root leaves the read set,
 * so the host runs that part of it (`HostConfigs.above`).
 */
export const readRootsBelowUnreadableFolders = (entryDir: string, jsReadRoot: string): string[] => {
  const spellings = readRootSpellings(entryDir, jsReadRoot);
  return spellings.filter((root) => {
    const parent = path.dirname(root);
    return parent !== root && !spellings.some(other => isInside(parent, other));
  });
};

/** The nearest directory at or above `file`'s realpath that holds a `package.json`. */
const packageRootOf = (file: string): string | undefined => {
  for (let dir = path.dirname(realpath(file) ?? file); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    if (path.dirname(dir) === dir) {
      return undefined;
    }
  }
};

/**
 * How the code-closure walk reads files: asynchronously, beside a render, or
 * synchronously, when a Deno start waits on the walk. The walk awaits either;
 * with synchronous reads every await settles in a microtask, so the walk ends
 * before any timer or I/O callback in this process runs, unless an
 * asynchronous walk of the same files is already in flight (see
 * {@link codeClosure}).
 */
type FileReads = {
  realpath: (p: string) => string | undefined | Promise<string | undefined>;
  readText: (file: string) => string | undefined | Promise<string | undefined>;
};

const asyncReads: FileReads = {
  realpath: p => fs.promises.realpath(p).catch(() => undefined),
  readText: file => fs.promises.readFile(file, 'utf8').catch(() => undefined)
};

const syncReads: FileReads = {
  realpath,
  readText: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  }
};

/** Node's package lookup, reduced to the directory: `<ancestor>/node_modules/<name>`, canonicalized. */
const packageDirFrom = async (name: string, fromDir: string, reads: FileReads, signal?: AbortSignal): Promise<string | undefined> => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    signal?.throwIfAborted();
    const candidate = await reads.realpath(path.join(dir, 'node_modules', name));
    if (candidate !== undefined) {
      return candidate;
    }
    if (path.dirname(dir) === dir) {
      return undefined;
    }
  }
};

type PackageManifest = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const readManifest = async (dir: string, reads: FileReads): Promise<PackageManifest> => {
  try {
    const parsed: unknown = JSON.parse(await reads.readText(path.join(dir, 'package.json')) ?? '');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const closures = new Map<string, Promise<string[]>>();

/**
 * The installed code of the compiler: the packages that hold `entryFiles` and
 * every package their dependencies (regular, optional and installed peer)
 * reach, as canonical directories. The engine loads this code as a render
 * needs it, so it is readable wherever it lies. Computed once per process,
 * by default with asynchronous file reads, so it runs beside a render in this
 * process instead of holding it up; with `reads: 'sync'` it reads synchronously
 * and settles in microtasks, so it ends before any timer or I/O callback runs.
 * A walk of the same files already in flight is joined whatever its reads, so
 * a `'sync'` call that finds an asynchronous walk under way waits on its I/O.
 */
export const codeClosure = async (entryFiles: readonly string[], signal?: AbortSignal, reads: 'async' | 'sync' = 'async'): Promise<string[]> => {
  const key = entryFiles.join('\u0000');
  let closure = closures.get(key);
  if (closure === undefined) {
    closure = walkClosure(entryFiles, reads === 'sync' ? syncReads : asyncReads, signal);
    closures.set(key, closure);
  }
  try {
    return await closure;
  } catch (err) {
    /*
     * A walk stopped part way (an ahead-of-time start let go) is not kept, and
     * a caller that did not ask to stop walks again.
     */
    if (closures.get(key) === closure) {
      closures.delete(key);
    }
    if (signal?.aborted !== true && err instanceof Error && err.name === 'AbortError') {
      return codeClosure(entryFiles, signal, reads);
    }
    throw err;
  }
};

const walkClosure = async (entryFiles: readonly string[], reads: FileReads, signal?: AbortSignal): Promise<string[]> => {
  const roots = new Set<string>();
  let level = entryFiles.map(packageRootOf).filter((dir): dir is string => dir !== undefined);
  while (level.length > 0) {
    const fresh = [...new Set(level)].filter(dir => !roots.has(dir));
    fresh.forEach(dir => roots.add(dir));
    const next = await Promise.all(fresh.map(async (dir) => {
      const manifest = await readManifest(dir, reads);
      const names = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {})
      ]);
      return Promise.all([...names].map(name => packageDirFrom(name, dir, reads, signal)));
    }));
    level = next.flat().filter((dir): dir is string => dir !== undefined);
  }
  return [...roots];
};

/**
 * A value in compiler options that cannot be sent to the engine: an object that
 * is neither data nor a plugin that records its factory (ledger A19).
 */
export class EngineOptionError extends Error {
  readonly code = 'plugin/engine-option';

  constructor(where: string, reason: string) {
    super(`Cannot run this compile in the Deno sandbox: the compiler option at ${where} ${reason}`);
    this.name = 'EngineOptionError';
  }
}

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isPluginModule = (value: unknown): value is { module: string; exportName: string; args: readonly unknown[] } =>
  typeof value === 'object' && value !== null
  && typeof Reflect.get(value, 'module') === 'string'
  && typeof Reflect.get(value, 'exportName') === 'string'
  && Array.isArray(Reflect.get(value, 'args'));

/**
 * Encodes compiler options as data for the engine. Plain data passes through.
 * A function is sent as its source and rebuilt in the sandbox (plugin
 * functions are pure). A plugin is sent as the factory that made it (its
 * `pluginModule`), so the engine makes its own. Anything else is refused.
 */
export const encodeEngineValue = (value: unknown, where: string): unknown => {
  if (typeof value === 'function') {
    return { __jessFn: { source: Function.prototype.toString.call(value), where } };
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => encodeEngineValue(item, `${where}[${index}]`));
  }
  const identity: unknown = Reflect.get(value, 'pluginModule');
  if (isPluginModule(identity)) {
    return {
      __jessPlugin: {
        module: identity.module,
        exportName: identity.exportName,
        args: encodeEngineValue(identity.args, `${where} (arguments)`)
      }
    };
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = encodeEngineValue(item, `${where}.${key}`);
    }
    return out;
  }
  const ctor: unknown = Reflect.get(value, 'constructor');
  const name = typeof ctor === 'function' && ctor.name !== '' ? ctor.name : 'an object';
  throw new EngineOptionError(where, `is an instance of ${name}, which the sandbox cannot make again. Pass a plain object, or a plugin from a factory that records itself with \`recordPluginModule\` from @jesscss/core.`);
};

/** The `styles.config` settings the host resolved for a render (the compiler's `HostConfigs`). */
export type HostConfigs = {
  folders: Record<string, unknown>;
  above: Record<string, unknown>;
};

/** The config files a resolved chain merges, or its folder: what a chain that cannot cross is named by. */
const configFilesOf = (chain: unknown, dir: string): string => {
  const files: unknown = typeof chain === 'object' && chain !== null ? Reflect.get(chain, 'configFilePaths') : undefined;
  return Array.isArray(files) && files.length > 0 ? files.join(', ') : dir;
};

/**
 * Encodes the host's resolved settings for the engine. Settings that cannot
 * cross (a plugin that records no factory) are sent as the config files they
 * come from, so a file that needs them fails, naming them, instead of
 * rendering without them.
 */
export const encodeHostConfigs = (configs: HostConfigs | undefined): HostConfigs | undefined => {
  if (configs === undefined) {
    return undefined;
  }
  const folders: Record<string, unknown> = {};
  for (const [dir, folder] of Object.entries(configs.folders)) {
    try {
      folders[dir] = encodeEngineValue(folder, `the styles.config settings of ${dir}`);
    } catch (err) {
      if (!(err instanceof EngineOptionError)) {
        throw err;
      }
      folders[dir] = { unsendable: configFilesOf(folder, dir) };
    }
  }
  const above: Record<string, unknown> = {};
  for (const [dir, chain] of Object.entries(configs.above)) {
    try {
      above[dir] = encodeEngineValue(chain, `the styles.config settings above ${dir}`);
    } catch (err) {
      if (!(err instanceof EngineOptionError)) {
        throw err;
      }
      above[dir] = { unsendable: configFilesOf(chain, dir) };
    }
  }
  return { folders, above };
};

/** The environment variables a render reads (`process.env`), sent as data: the sandbox reads no env. */
const ENGINE_ENV_KEYS = ['JESS_PROFILE', 'JESS_NO_DECLMAP_MEMO', 'NO_COLOR', 'FORCE_COLOR'];

export type EngineHostFacts = {
  cwd: string;
  homedir: string;
  tmpdir: string;
  cosmiconfigLoaders: string | undefined;
  columns: number | undefined;
  env: Record<string, string>;
  nodePath: string[];
};

export const hostFacts = (code: readonly string[]): EngineHostFacts => {
  const cosmiconfig = code.find(dir => path.basename(dir) === 'cosmiconfig');
  const loaders = cosmiconfig === undefined ? undefined : path.join(cosmiconfig, 'dist', 'loaders.js');
  return {
    cwd: process.cwd(),
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    cosmiconfigLoaders: loaders !== undefined && fs.existsSync(loaders) ? loaders : undefined,
    columns: process.stdout.columns,
    nodePath: (process.env.NODE_PATH ?? '').split(path.delimiter).filter(entry => entry !== '').map(entry => path.resolve(entry)),
    env: Object.fromEntries(ENGINE_ENV_KEYS.flatMap((key) => {
      const item = process.env[key];
      return item === undefined ? [] : [[key, item]];
    }))
  };
};

/**
 * The packages of a compiler module and this plugin themselves, without the
 * dependencies {@link engineCode} walks to: part of every engine's code, known
 * without reading a manifest.
 */
export const engineOwnCode = (compilerModule: string, selfModule: string): string[] =>
  [fileURLToPath(compilerModule), fileURLToPath(selfModule)].map(packageRootOf).filter((dir): dir is string => dir !== undefined);

/** The code directories of a compiler module and this plugin. */
export const engineCode = (compilerModule: string, selfModule: string, signal?: AbortSignal, reads: 'async' | 'sync' = 'async'): Promise<string[]> =>
  codeClosure([fileURLToPath(compilerModule), fileURLToPath(selfModule)], signal, reads);

/** A failed engine render, rethrown here: a `JessError` as one (so it prints the same frame), else an `Error`. */
export const engineFailure = (result: {
  jessError?: Record<string, unknown>;
  error?: string;
  errorName?: string;
  code?: string;
  stack?: string;
}): Error | JessError => {
  if (result.jessError !== undefined) {
    return Object.assign(new JessError({ code: 'plugin/load-failed', phase: 'eval' }), result.jessError);
  }
  const name = result.errorName ?? 'Error';
  return Object.assign(new Error(result.error ?? 'The compile engine failed.'), {
    name,
    code: result.code,
    ...(result.stack === undefined
      ? {}
      : { stack: `${name}: ${result.error ?? ''}\n    [in the Deno compile engine]\n${result.stack.split('\n').slice(1).join('\n')}` })
  });
};

/**
 * The `deno run` arguments of the sandbox (ledger A19): read only `readSet`,
 * every other read answered "not found" (`--ignore-read`), network (remote
 * module imports included) only with `allowHttp`, and no env, write, run, ffi
 * or sys. Deno enforces them itself.
 */
export const denoRunArgs = (
  readSet: readonly string[],
  opts: { allowHttp?: boolean; allowNetHosts?: string[]; runtimeApi?: string },
  workerScriptPath: string
): string[] => {
  /* Deno splits a flag's list on `,`; a `,` inside a path is written `,,`. */
  const list = (items: readonly string[]) => items.map(item => item.replaceAll(',', ',,')).join(',');
  const hosts = opts.allowNetHosts ?? [];
  const net = !opts.allowHttp ? [] : hosts.length === 0 ? ['--allow-net'] : [`--allow-net=${list(hosts)}`];

  /*
   * A remote module import is network too, and Deno allows one from a default
   * list of hosts (deno.land, esm.sh, …) without `--allow-net`, so it follows
   * the net rule, narrowed to `allowNetHosts` as `--allow-net` is.
   */
  const imports = !opts.allowHttp
    ? ['--no-remote']
    : hosts.length === 0 ? ['--allow-import'] : [`--allow-import=${list(hosts)}`];
  return [
    'run',
    '--no-prompt',
    `--allow-read=${list(readSet)}`,
    '--ignore-read',

    /*
     * Bare imports read the `node_modules` above the importing file and nothing
     * else, wherever the packages are installed. Left to itself, Deno picks a
     * mode from the configs above this script: a global install has none and
     * cannot find its own packages, and a `deno.json` asking for npm packages
     * has it fetch and write them. An `npm:` import of a package not installed
     * is refused, with or without `allowHttp`.
     */
    '--node-modules-dir=manual',
    ...net,
    ...imports,
    '--unstable-bare-node-builtins',

    /* A compiler run from its TypeScript sources (a workspace test run) imports `./x.js` for `./x.ts`. */
    '--unstable-sloppy-imports',
    workerScriptPath,
    `--runtime-api=${opts.runtimeApi ?? 'module'}`
  ];
};
