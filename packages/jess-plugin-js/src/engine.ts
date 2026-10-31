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

/** The packages a `node_modules` folder lists: its entries, and the entries of each `@scope` folder. */
const packageEntries = (nodeModules: string): string[] => {
  const entries: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(nodeModules);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (name.startsWith('.')) {
      continue;
    }
    const full = path.join(nodeModules, name);
    if (!name.startsWith('@')) {
      entries.push(full);
      continue;
    }
    try {
      for (const scoped of fs.readdirSync(full)) {
        entries.push(path.join(full, scoped));
      }
    } catch {
      // not a folder
    }
  }
  return entries;
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
      const roots = new Set<string>();
      for (const entry of packageEntries(nodeModules)) {
        const real = realpath(entry);
        const outer = real === undefined ? undefined : outermostNodeModules(real);
        if (outer !== undefined) {
          roots.add(path.dirname(outer));
        }
      }
      return [...roots];
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
 * folder its packages live in) is kept as its own root, since dropping it
 * would make the entry unreadable.
 */
export const readRootsOf = (entryDir: string, jsReadRoot: string): string[] => {
  const key = `${entryDir}\u0000${jsReadRoot}`;
  const cached = readRootCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const canonical = (dir: string) => realpath(dir) ?? path.resolve(dir);
  const candidates = [canonical(entryDir), canonical(jsReadRoot), ...governingPackageRoots(entryDir)];
  const roots = candidates.filter((dir, index) =>
    !candidates.some((other, at) => at !== index && isInside(dir, other) && (dir !== other || at < index)));
  readRootCache.set(key, roots);
  return roots;
};

/**
 * The `--allow-read` list for a render: each read root in its real spelling
 * and in every written spelling the render uses for it (an ancestor of the
 * entry folder or the script root whose real path it is), because Deno
 * matches paths as written; then each code directory not already under one.
 */
export const readSetFor = (entryDir: string, jsReadRoot: string, code: readonly string[]): string[] => {
  const roots = readRootsOf(entryDir, jsReadRoot);
  const spellings = new Set(roots);
  for (const written of [path.resolve(entryDir), path.resolve(jsReadRoot)]) {
    for (let dir = written; ; dir = path.dirname(dir)) {
      const real = realpath(dir);
      if (real !== undefined && real !== dir && roots.includes(real)) {
        spellings.add(dir);
      }
      if (path.dirname(dir) === dir) {
        break;
      }
    }
  }
  const all = [...spellings];
  return [...all, ...code.filter(dir => !all.some(root => isInside(dir, root)))];
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

/** Node's package lookup, reduced to the directory: `<ancestor>/node_modules/<name>`, canonicalized. */
const packageDirFrom = (name: string, fromDir: string): string | undefined => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = realpath(path.join(dir, 'node_modules', name));
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

const readManifest = (dir: string): PackageManifest => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const closures = new Map<string, string[]>();

/**
 * The installed code of the compiler: the packages that hold `entryFiles` and
 * every package their dependencies (regular, optional and installed peer)
 * reach, as canonical directories. The engine loads this code as a render
 * needs it, so it is readable wherever it lies. Computed once per process.
 */
export const codeClosure = (entryFiles: readonly string[]): string[] => {
  const key = entryFiles.join('\u0000');
  const cached = closures.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const roots = new Set<string>();
  const queue = entryFiles.map(packageRootOf).filter((dir): dir is string => dir !== undefined);
  while (queue.length > 0) {
    const dir = queue.pop()!;
    if (roots.has(dir)) {
      continue;
    }
    roots.add(dir);
    const manifest = readManifest(dir);
    for (const name of new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {})
    ])) {
      const depDir = packageDirFrom(name, dir);
      if (depDir !== undefined) {
        queue.push(depDir);
      }
    }
  }
  const result = [...roots];
  closures.set(key, result);
  return result;
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
  throw new EngineOptionError(where, `is an instance of ${name} that does not record the factory that made it. A plugin factory records it with \`recordPluginModule\` from @jesscss/core.`);
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

/** The code directories of a compiler module and this plugin. */
export const engineCode = (compilerModule: string, selfModule: string): string[] =>
  codeClosure([fileURLToPath(compilerModule), fileURLToPath(selfModule)]);

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
 * every other read answered "not found" (`--ignore-read`), network only with
 * `allowHttp`, and no env, write, run, ffi or sys. Deno enforces them itself.
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
  return [
    'run',
    '--no-prompt',
    `--allow-read=${list(readSet)}`,
    '--ignore-read',
    ...net,
    '--unstable-bare-node-builtins',

    /* A compiler run from its TypeScript sources (a workspace test run) imports `./x.js` for `./x.ts`. */
    '--unstable-sloppy-imports',
    workerScriptPath,
    `--runtime-api=${opts.runtimeApi ?? 'module'}`
  ];
};
