/* eslint-disable @typescript-eslint/naming-convention -- `__jessFn` / `__jessInstance` are the fixed engine wire tags. */
/**
 * Host-side helpers for the Deno compile engine (`jsSandbox: 'compile'`): the
 * read roots the compile needs, and the encoding of compiler options into data
 * the engine can rebuild. Internal; not exported from the package.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JessError } from '@jesscss/core';

type PluginLogRecord = { level: 'warn' | 'error' | 'info' | 'debug'; message: string };

/** The in-process script runtime (`plugin-runtime.ts`), typed at the boundary. */
export type InProcessRuntime = {
  loadModule(modulePath: string): Promise<Array<{ name: string; kind: 'function' | 'value'; value?: unknown }>>;
  invokeExport(modulePath: string, exportName: string, args: unknown[]): Promise<unknown>;
  loadLessPlugin(modulePath: string, options: string | null): Promise<string[]>;
  invokeLessPluginFunction(
    modulePath: string,
    functionName: string,
    args: unknown[],
    options: string | null,
    facts: {
      variable(name: string): { value: unknown; important?: boolean } | null;
      call(name: string, args: unknown[]): unknown;
      fileInfo: { filename: string; entryPath: string } | null;
    }
  ): Promise<{ value?: unknown; logs: PluginLogRecord[]; important?: boolean }>;
};

export const loadInProcessRuntime = async (): Promise<InProcessRuntime> => {
  const runtime: InProcessRuntime = await import('./plugin-runtime.js');
  return runtime;
};

/** A thrown value's fields, as the sandbox reports them across the wire. */
export const thrownFields = (err: unknown): { error: string; errorName: string; stack: string | undefined } => ({
  error: err instanceof Error ? err.message : String(err),
  errorName: err instanceof Error ? err.name : 'Error',
  stack: err instanceof Error ? err.stack : undefined
});

/**
 * `p` with every symlink resolved. A path that does not exist yet (a probe for
 * a file that may be absent) resolves through its nearest existing ancestor,
 * so a probe under a symlinked root is judged by where it really points.
 */
export const canonicalPath = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(canonicalPath(parent), path.basename(p));
  }
};

const realpath = (p: string): string | undefined => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return undefined;
  }
};

/** The nearest directory at or above `file`'s realpath that holds a `package.json`. */
export const packageRootOf = (file: string): string | undefined => {
  let dir = path.dirname(realpath(file) ?? file);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
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
  [key: string]: unknown;
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const isManifest = (value: unknown): value is PackageManifest => typeof value === 'object' && value !== null;

const readManifest = (dir: string): PackageManifest => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return isManifest(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * The installed code of the compiler: the package that holds `entryFile` and
 * every package its dependencies (regular, optional and installed peer) reach,
 * as canonical directories. This is the engine's own code, which it loads
 * lazily as a compile needs it, so it is readable for the life of the engine.
 */
export const codeClosure = (entryFiles: readonly string[]): string[] => {
  const roots = new Set<string>();
  const queue = entryFiles.map(packageRootOf).filter((dir): dir is string => dir !== undefined);
  while (queue.length > 0) {
    const dir = queue.pop()!;
    if (roots.has(dir)) {
      continue;
    }
    roots.add(dir);
    const manifest = readManifest(dir);
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {})
    ]);
    for (const name of names) {
      const depDir = packageDirFrom(name, dir);
      if (depDir !== undefined) {
        queue.push(depDir);
      }
    }
  }
  return [...roots];
};

/**
 * The packages in each `NODE_PATH` folder, canonicalized. Node resolves a
 * stylesheet's package imports through these folders as well, so the engine
 * may read the packages there, but not the folders' other contents, and not
 * where a package's symlink does not lead.
 */
export const nodePathPackages = (nodePath: readonly string[]): string[] => {
  const out: string[] = [];
  for (const dir of nodePath) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('@')) {
        for (const scoped of fs.readdirSync(full)) {
          const target = realpath(path.join(full, scoped));
          if (target !== undefined) {
            out.push(target);
          }
        }
      } else if (!entry.name.startsWith('.')) {
        const target = realpath(full);
        if (target !== undefined) {
          out.push(target);
        }
      }
    }
  }
  return out;
};

/** The file names a styles config search probes for in each folder it visits. */
const CONFIG_PROBES = new Set([
  'styles.config.ts',
  'styles.config.js',
  'styles.config.mts',
  'styles.config.mjs',
  'styles.config.cjs',
  'styles.config.cts',
  'package.json',
  'package.yaml'
]);

/**
 * The folders a styles config search visits for a source under `root`: `root`
 * and each folder above it up to the package root (the first with a
 * `package.json`), where the search stops (DESIGN-DECISIONS O19).
 */
export const configSearchDirs = (root: string): string[] => {
  const dirs: string[] = [];
  for (let dir = root; ; dir = path.dirname(dir)) {
    dirs.push(dir);
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'package.yaml')) || path.dirname(dir) === dir) {
      return dirs;
    }
  }
};

/**
 * Whether `realPath` is something a styles config search reads in a folder it
 * visits ({@link configSearchDirs}): the folder itself (the search checks it is
 * a directory) and the exact names it probes there. The compile finds and loads
 * each source's `styles.config.*` itself, so these are reads it needs; nothing
 * else in those folders is readable for that.
 */
export const isConfigProbe = (realPath: string, searchDirs: ReadonlySet<string>): boolean =>
  searchDirs.has(realPath)
  || (CONFIG_PROBES.has(path.basename(realPath)) && searchDirs.has(path.dirname(realPath)));

const META_CONFIG_NAMES = new Set(['config.json', 'config.yaml', 'config.yml', 'config.js', 'config.ts', 'config.cjs', 'config.mjs']);

/**
 * Whether `realPath` is what the config loader (cosmiconfig) probes in the
 * working directory for its own meta config when it starts: the directory
 * itself, its `package.json`/`package.yaml`, and `.config/config.*`. Nothing
 * else in or above the working directory is readable for that.
 */
export const isCwdMetaProbe = (realPath: string, cwd: string): boolean => {
  const dir = path.dirname(realPath);
  const name = path.basename(realPath);
  return realPath === cwd
    || (dir === cwd && (name === 'package.json' || name === 'package.yaml' || name === '.config'))
    || (dir === path.join(cwd, '.config') && META_CONFIG_NAMES.has(name));
};

type ModuleIdentity = { module: string; exportName: string };

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** An ES module entry of a package directory, as `import` resolves it. */
const moduleEntryOf = (dir: string): string | undefined => {
  const manifest: Record<string, unknown> = readManifest(dir);
  const root: unknown = typeof manifest.exports === 'object' && manifest.exports !== null
    ? Reflect.get(manifest.exports, '.')
    : manifest.exports;
  const conditional = typeof root === 'object' && root !== null
    ? Reflect.get(root, 'import') ?? Reflect.get(root, 'default')
    : root;
  const entry = [conditional, manifest.module, manifest.main].find((item): item is string => typeof item === 'string');
  return entry === undefined ? undefined : pathToFileURL(path.resolve(dir, entry)).href;
};

/**
 * Finds the module that exports `ctor`, by identity: first Node's CommonJS
 * registry, then the ES module entries of the given packages (an ES module the
 * process already imported returns the same namespace, so the class compares
 * equal). Undefined when no candidate exports it.
 */
const findExport = async (ctor: unknown, packages: readonly string[]): Promise<ModuleIdentity | undefined> => {
  const cache = createRequire(import.meta.url).cache;
  for (const [filename, record] of Object.entries(cache)) {
    const exported: unknown = record?.exports;
    if (typeof exported === 'object' && exported !== null) {
      for (const [name, item] of Object.entries(exported)) {
        if (item === ctor) {
          return { module: pathToFileURL(filename).href, exportName: name };
        }
      }
    }
  }
  let byName: ModuleIdentity | undefined;
  for (const dir of packages) {
    const entry = moduleEntryOf(dir);
    if (entry === undefined) {
      continue;
    }
    let namespace: object;
    try {
      const loaded: unknown = await import(entry);
      if (typeof loaded !== 'object' || loaded === null) {
        continue;
      }
      namespace = loaded;
    } catch {
      continue;
    }
    const match = Object.entries(namespace).find(([name, item]) => item === ctor && name !== 'default')
      ?? Object.entries(namespace).find(([, item]) => item === ctor);
    if (match) {
      return { module: entry, exportName: match[0] };
    }
    if (byName === undefined && typeof ctor === 'function' && ctor.name !== '') {
      const named: unknown = Reflect.get(namespace, ctor.name);
      if (typeof named === 'function' && named.name === ctor.name) {
        byName = { module: entry, exportName: ctor.name };
      }
    }
  }

  /*
   * ponytail: no module exports the very class, but a candidate package exports
   * a class of the same name: the instance came from another copy of that
   * package's code (a source alias, a bundled copy). The first such package
   * wins; a name shared by two plugin packages would need the identity match.
   */
  return byName;
};

/**
 * A value in compiler options that cannot be sent to the engine: an object
 * whose class no installed module exports, or a value that is not data.
 */
export class EngineOptionError extends Error {
  readonly code = 'plugin/engine-option';

  constructor(where: string, reason: string) {
    super(`Cannot run this compile in the Deno sandbox: the compiler option at ${where} ${reason}`);
    this.name = 'EngineOptionError';
  }
}

/**
 * Encodes compiler options as data for the engine. Plain data passes through.
 * A function is sent as its source (`fn.toString()`) and rebuilt in the
 * sandbox, which is sound because plugin functions are pure; one that reads
 * the caller's variables fails there, naming the variable. An object of a
 * class (a plugin instance) is sent by identity: the module that exports its
 * class, and its `opts`, so the engine constructs its own — never a live
 * object across the boundary.
 */
export const encodeEngineValue = async (
  value: unknown,
  where: string,
  packages: readonly string[]
): Promise<unknown> => {
  if (typeof value === 'function') {
    return { __jessFn: { source: Function.prototype.toString.call(value), where } };
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item, index) => encodeEngineValue(item, `${where}[${index}]`, packages)));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = await encodeEngineValue(item, `${where}.${key}`, packages);
    }
    return out;
  }
  const ctor: unknown = Reflect.get(value, 'constructor');
  const identity = await findExport(ctor, packages);
  if (identity === undefined) {
    const name = typeof ctor === 'function' && ctor.name !== '' ? ctor.name : 'an anonymous class';
    throw new EngineOptionError(where, `is an instance of ${name}, which no installed module exports. Export the class from a module, or name the plugin by its package in compile.plugins.`);
  }
  const opts: unknown = Reflect.get(value, 'opts');
  return {
    __jessInstance: {
      ...identity,
      args: opts === undefined ? [] : [await encodeEngineValue(opts, `${where}.opts`, packages)]
    }
  };
};

export type EngineRenderRequest = {
  /** The module and export of the compiler class the host runs, rebuilt in the engine by identity. */
  compiler: { module: string; exportName: string };
  filePath: string;
  compilerOptions: unknown;
  renderOptions: unknown;

  /** The entry's script root (`jsReadRoot`), and the include paths the compile reads stylesheets from. */
  jsReadRoot: string;
  readRoots: readonly string[];
};

/** One whole compile, sent to the Deno compile engine (`jsSandbox: 'compile'`). */
export type EngineCompileRequest = {
  type: 'compile';
  compiler: { module: string; exportName: string };
  filePath: string;
  compilerOptions: unknown;
  renderOptions: unknown;
  host: {
    cwd: string;
    homedir: string;
    tmpdir: string;
    cosmiconfigLoaders: string | undefined;
    columns: number | undefined;
    env: Record<string, string>;
    nodePath: string[];
  };
};

/** The engine's code: its package closure, the plugin packages in it, and cosmiconfig's loaders module. */
export type EngineCode = { roots: string[]; plugins: string[]; cosmiconfigLoaders: string | undefined };

export const engineCodeOf = (compilerModule: string, selfModule: string): EngineCode => {
  const roots = codeClosure([fileURLToPath(compilerModule), fileURLToPath(selfModule)]);
  const cosmiconfig = roots.find(dir => path.basename(dir) === 'cosmiconfig');
  const loaders = cosmiconfig === undefined ? undefined : path.join(cosmiconfig, 'dist', 'loaders.js');
  return {
    roots,
    plugins: roots.filter(dir => /plugin/i.test(path.basename(dir))),
    cosmiconfigLoaders: loaders !== undefined && fs.existsSync(loaders) ? loaders : undefined
  };
};

/**
 * The environment variables a compile reads (`process.env`), sent to the
 * compile engine as data so the sandbox needs no `env` permission.
 */
const ENGINE_ENV_KEYS = ['JESS_PROFILE', 'JESS_NO_DECLMAP_MEMO', 'NO_COLOR'];

/**
 * The request for one engine compile, and the read policy it runs under:
 * the compiler's code, the include paths and `NODE_PATH` packages, the folders
 * a config search visits, and the working directory's meta-config probes.
 */
export const prepareEngineCompile = async (
  request: EngineRenderRequest,
  code: EngineCode
): Promise<{
  payload: EngineCompileRequest;
  policy: { code: string[]; read: string[]; configDirs: Set<string>; cwd: string };
}> => {
  const nodePath = (process.env.NODE_PATH ?? '').split(path.delimiter).filter(entry => entry !== '').map(entry => path.resolve(entry));
  const [compilerOptions, renderOptions] = await Promise.all([
    encodeEngineValue(request.compilerOptions, 'options', code.plugins),
    encodeEngineValue(request.renderOptions, 'render options', code.plugins)
  ]);
  const readRoots = request.readRoots.map(root => canonicalPath(path.resolve(root)));
  const env = Object.fromEntries(ENGINE_ENV_KEYS.flatMap(key => (process.env[key] === undefined ? [] : [[key, process.env[key]]])));
  return {
    payload: {
      type: 'compile',
      compiler: request.compiler,
      filePath: request.filePath,
      compilerOptions,
      renderOptions,
      host: {
        cwd: process.cwd(),
        homedir: os.homedir(),
        tmpdir: os.tmpdir(),
        cosmiconfigLoaders: code.cosmiconfigLoaders,
        columns: process.stdout.columns,
        env,
        nodePath
      }
    },
    policy: {
      code: code.roots,
      read: [...readRoots, ...nodePathPackages(nodePath)],
      configDirs: new Set([canonicalPath(path.resolve(request.jsReadRoot)), ...readRoots].flatMap(configSearchDirs)),
      cwd: canonicalPath(process.cwd())
    }
  };
};

/** A failed engine compile, rethrown here: a `JessError` as one (so it prints the same frame), else an `Error`. */
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
