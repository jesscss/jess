/**
 * Where a render runs (ledger A19, `docs/design/DENO-SANDBOX-COMPILE.md`): in
 * this process, or, once it reaches a stylesheet script, whole in the
 * `@jesscss/plugin-js` Deno engine.
 */
import type { ErrorDiagnostic, ExportRuntimeData, JessSpellingGap, PluginInterface, ScriptSandboxRoute, WarningDiagnostic } from '@jesscss/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigWithMeta, HostConfigs, UnusableConfig } from './config.js';
import { colorsByDefault } from './diagnostics.js';
import type { ConfigOptions } from './index.js';

export type RenderInput = string | { source: string; filePath?: string; language?: string; extension?: string };

export type RenderStringOptions = {
  filePath?: string;
  language?: string;
  extension?: string;
  config?: Partial<ConfigOptions>;
};

export type RenderResult = {
  css: string;
  errors: ErrorDiagnostic[];
  warnings: WarningDiagnostic[];
  loadedUrls: string[];

  /** v3 source map JSON, present only when source maps are enabled. */
  map?: string;

  /** The `sourceMappingURL` written into the CSS annotation, when one is written. */
  sourceMapURL?: string;

  /** What the browser runtime module is generated from, when the stylesheet exports a variable (ledger A4). */
  runtime?: ExportRuntimeData;
};

/** The `.jess` file a converted source writes: its sibling, extension replaced. */
export const jessPathOf = (source: string): string => `${source.slice(0, source.length - path.extname(source).length)}.jess`;

/** One converted document (by its source path): its `.jess` text, or every construct `.jess` cannot spell. */
export type ConvertedFile = { readonly source: string; readonly jessPath: string } & (
  | { readonly jess: string }
  | { readonly gaps: readonly JessSpellingGap[] }
);

/** How `Compiler.convertToJess` treats a `.jess` path that already exists. */
export type ConvertOptions = {
  /** Replace an existing `.jess` file; without it, one is a gap. A symlink, or a file the render loaded, is never replaced. */
  overwrite?: boolean;
};

/** What `Compiler.convertToJess` produced — plain data, so it crosses from the sandbox — and the render's diagnostics. */
export type JessConversion = {
  files: readonly ConvertedFile[];
  errors: ErrorDiagnostic[];
  warnings: WarningDiagnostic[];
};

export type SafeRenderResult = {
  css: string | null;
  errors: ErrorDiagnostic[];
  warnings: WarningDiagnostic[];
};

/** The module and export of a compiler class, so the script sandbox can make the same compiler. */
export type CompilerModuleIdentity = { module: string; exportName: string };

export type EngineMethod = 'render' | 'renderToResult' | 'renderString' | 'safeRender' | 'convertToJess';

/** The script plugin's compile engine (`@jesscss/plugin-js`): one whole render in its Deno sandbox. */
export type EnginePlugin = PluginInterface & {
  renderInEngine(request: {
    compiler: CompilerModuleIdentity;
    compilerOptions: unknown;
    method: EngineMethod;
    args: readonly unknown[];
    entryDir: string;
    jsReadRoot: string;

    /** The `styles.config` settings the host resolved, sent as data (see `hostConfigsFor`). */
    configs?: HostConfigs;

    /** The host's config search above a read root, for `configs.above` (see `configsAboveReadRoot`). */
    configsAbove?: (root: string) => ConfigWithMeta | UnusableConfig | undefined;
  }): Promise<unknown>;

  /** Starts the engine before a render needs it; `releaseEngine` ends it unused. */
  prewarmEngine?(request: {
    compiler: CompilerModuleIdentity;
    compilerOptions: unknown;
    entryDir: string;
    jsReadRoot: string;
    extension: string | undefined;
  }): void;
  releaseEngine?(): void;

  /** The folders a render's engine may read stylesheets from, computed on this host. */
  readRoots?(request: { entryDir: string; jsReadRoot: string }): Promise<readonly string[]>;
};

export const isEnginePlugin = (plugin: PluginInterface): plugin is EnginePlugin =>
  typeof Reflect.get(plugin, 'renderInEngine') === 'function';

/** The identity a compiler class declares as its OWN `moduleIdentity` (a subclass that does not is not rebuilt as its parent). */
export const compilerModuleOf = (compiler: object): CompilerModuleIdentity | undefined => {
  const ctor: unknown = compiler.constructor;
  if (typeof ctor !== 'function' || !Object.hasOwn(ctor, 'moduleIdentity')) {
    return undefined;
  }
  const identity: unknown = Reflect.get(ctor, 'moduleIdentity');
  if (typeof identity !== 'object' || identity === null) {
    return undefined;
  }
  const module: unknown = Reflect.get(identity, 'module');
  const exportName: unknown = Reflect.get(identity, 'exportName');
  return typeof module === 'string' && typeof exportName === 'string' ? { module, exportName } : undefined;
};

/** A render sent to the engine prints there, so its colour default follows THIS process's stderr. */
export const withColors = <T extends { colors?: boolean }>(options: T | undefined): T | { colors: boolean } =>
  options?.colors !== undefined ? options : { ...options, colors: colorsByDefault(process.stderr) };

const isDiagnosticList = (value: unknown): boolean => Array.isArray(value);

/** `Array.isArray` without its `any[]` narrowing. */
const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** What the engine returns for each method, checked before it is handed back as that method's result. */
export const fromEngine = {
  render: (value: unknown): string => {
    if (typeof value !== 'string') {
      throw new Error('The compile engine returned no CSS for this render.');
    }
    return value;
  },
  renderResult: (value: unknown): RenderResult => {
    if (!isRenderResultLike(value) || typeof value.css !== 'string' || !Array.isArray(value.loadedUrls)) {
      throw new Error('The compile engine returned no result for this render.');
    }
    return { ...value, css: value.css, loadedUrls: value.loadedUrls };
  },
  safeRenderResult: (value: unknown): SafeRenderResult => {
    if (!isRenderResultLike(value) || (typeof value.css !== 'string' && value.css !== null)) {
      throw new Error('The compile engine returned no result for this render.');
    }
    return { ...value, css: value.css };
  },

  /**
   * Every entry is rebuilt from checked fields (ledger A19). Its `source` must
   * be a `.less`, `.scss` or `.css` file that, and whose folder, with `..` and
   * symlinks resolved, lie inside `readRoots`, the folders the host let the
   * engine read. Its `jessPath` is derived here from `source` as the render
   * spelled it, as the in-process route derives it, and must not be a symlink,
   * nor, for `.jess` text, an existing file unless `overwrite` is set, nor a
   * hard-linked one even then. So the
   * engine can only point the host at the `.jess` sibling of a stylesheet it
   * was allowed to read.
   */
  conversion: (value: unknown, readRoots: readonly string[], overwrite: boolean): JessConversion => {
    const files: unknown = isRenderResultLike(value) ? Reflect.get(value, 'files') : undefined;
    if (!isRenderResultLike(value) || !isList(files)) {
      throw new Error('The compile engine returned no result for this conversion.');
    }
    return { files: files.map(entry => convertedFileFromEngine(entry, readRoots, overwrite)), errors: value.errors, warnings: value.warnings };
  }
};

const CONVERTIBLE = new Set(['.less', '.scss', '.css']);

/** Whether `file`, with `..` and symlinks resolved, lies inside one of `roots`. */
const within = (file: string, roots: readonly string[]): boolean => {
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return false;
  }
  return roots.some(root => real === root || real.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`));
};

/** Whether `file` is a stylesheet file that, and whose folder, lie inside one of `roots`. */
const stylesheetWithin = (file: string, roots: readonly string[]): boolean =>
  path.isAbsolute(file) && CONVERTIBLE.has(path.extname(file)) && within(file, roots) && within(path.dirname(file), roots)
  && CONVERTIBLE.has(path.extname(fs.realpathSync(file))) && fs.statSync(file).isFile();

const convertedFileFromEngine = (entry: unknown, roots: readonly string[], overwrite: boolean): ConvertedFile => {
  const named: unknown = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'source') : undefined;
  const source = typeof named === 'string' && stylesheetWithin(named, roots) ? named : undefined;
  const jessPath = source === undefined ? '' : jessPathOf(source);
  const existing = source === undefined ? undefined : fs.lstatSync(jessPath, { throwIfNoEntry: false });
  if (typeof entry !== 'object' || entry === null || source === undefined || existing?.isSymbolicLink() === true) {
    throw new Error('The compile engine returned a converted file that is not a stylesheet in this render\'s read roots.');
  }
  const jess: unknown = Reflect.get(entry, 'jess');
  if (typeof jess === 'string') {
    if (existing !== undefined && (!overwrite || existing.nlink > 1)) {
      throw new Error(`The compile engine returned \`.jess\` text for ${jessPath}, which exists${existing.nlink > 1 ? ' and is hard-linked' : ', without `overwrite`'}.`);
    }
    return { source, jessPath, jess };
  }
  const gaps: unknown = Reflect.get(entry, 'gaps');
  if (!isList(gaps)) {
    throw new Error(`The compile engine returned neither \`.jess\` text nor gaps for ${source}.`);
  }
  return {
    source,
    jessPath,
    gaps: gaps.map((gap): JessSpellingGap => {
      const nodeType: unknown = typeof gap === 'object' && gap !== null ? Reflect.get(gap, 'nodeType') : undefined;
      const reason: unknown = typeof gap === 'object' && gap !== null ? Reflect.get(gap, 'reason') : undefined;
      if (typeof nodeType !== 'string' || typeof reason !== 'string') {
        throw new Error(`The compile engine returned a malformed gap for ${source}.`);
      }
      return { nodeType, reason };
    })
  };
};

const isRenderResultLike = (value: unknown): value is {
  css: unknown;
  loadedUrls?: unknown;
  errors: ErrorDiagnostic[];
  warnings: WarningDiagnostic[];
} => typeof value === 'object' && value !== null
  && isDiagnosticList(Reflect.get(value, 'errors'))
  && isDiagnosticList(Reflect.get(value, 'warnings'));

/**
 * Whether this realm is the script sandbox's engine (`@jesscss/plugin-js` sets
 * the key there). A render there runs where it is, with no route out.
 */
export const inScriptSandbox = (): boolean => Reflect.get(globalThis, Symbol.for('@jesscss/plugin-js/engine')) === true;

/** Whether a render in this process has started an engine ahead of time (one does, at most). */
let prewarmed = false;

/** Resolves a race when a render moved into the sandbox. */
const REROUTED: unique symbol = Symbol('rerouted');

/** One render a compiler entry point routes (see {@link routeRender}). */
export type RoutedCall<T> = {
  /** The entry point's arguments, as the engine's compiler receives them. */
  engineArgs: readonly unknown[];
  filePath: string | undefined;

  /** The entry this render is remembered by once it needed the sandbox; none for source text. */
  memoKey?: string;
  options: Partial<ConfigOptions> | undefined;

  /** Checks what the engine returned as this entry point's result. */
  check: (value: unknown) => T | Promise<T>;

  /** The render in this process; it reaches the script plugin with `route`. */
  here: (route: ScriptSandboxRoute | undefined) => Promise<T>;
};

/**
 * Runs a render in this process, unless it reaches a stylesheet script the
 * script plugin sandboxes. Then the render here is abandoned where it stands
 * and runs again, whole, in the plugin's Deno engine; an entry that did is
 * sent there directly from then on.
 */
export const routeRender = async <T>(call: RoutedCall<T> & {
  entries: Set<string>;
  inEngine: () => Promise<unknown>;

  /** Starts the engine ahead of time (the first render in a process); the returned release ends it unused. */
  prewarm?: () => () => void;
}): Promise<T> => {
  const inEngine = async () => call.check(await call.inEngine());
  if (call.memoKey !== undefined && call.entries.has(call.memoKey)) {
    return inEngine();
  }
  let release: (() => void) | undefined;
  if (!prewarmed && call.prewarm !== undefined) {
    prewarmed = true;
    release = call.prewarm();
  }
  let reroute = (): void => undefined;
  const rerouted = new Promise<typeof REROUTED>((resolve) => {
    reroute = () => resolve(REROUTED);
  });
  const inProcess = call.here({
    reroute: () => {
      reroute();
      return new Promise<never>(() => undefined);
    }
  });

  /* After a reroute this render is abandoned; a late failure of it is not this call's. */
  inProcess.catch(() => undefined);
  let outcome: T | typeof REROUTED;
  try {
    outcome = await Promise.race([inProcess, rerouted]);
  } catch (err) {
    release?.();
    throw err;
  }
  if (outcome !== REROUTED) {
    release?.();
    return outcome;
  }
  if (call.memoKey !== undefined) {
    call.entries.add(call.memoKey);
  }
  return inEngine();
};

/** The script plugin's engine per script-plugin config key: one Deno process each. */
export type EngineCache = Map<string, Promise<EnginePlugin | undefined>>;

/** Where a compiler's engine comes from (see {@link engineFor}). */
export type EngineSource = {
  configured: readonly PluginInterface[];
  engines: EngineCache;
  label: string;
  factory: () => { key: string; factoryPromise: Promise<{ create(): PluginInterface }> } | undefined;
};

/** What decides a render's engine request: the compiler, and the read root's inputs. */
export type EngineRequest = {
  compiler: CompilerModuleIdentity;
  compilerOptions: unknown;
  filePath: string | undefined;
  jsReadRoot: string | undefined;
};

/**
 * The engine a render runs in: a script plugin configured by instance (under
 * its own options, `jsReadRoot`, `allowHttp`), else the compiler's script
 * plugin, one engine per script-plugin config.
 */
const engineFor = async (source: EngineSource): Promise<EnginePlugin> => {
  const configured = source.configured.find(isEnginePlugin);
  if (configured !== undefined) {
    return configured;
  }
  const factory = source.factory();
  if (factory === undefined) {
    throw new Error(`Feature not supported. Install ${source.label} where the compiler is installed (beside @jesscss/jess or less) to enable script execution features.`);
  }
  let engine = source.engines.get(factory.key);
  if (engine === undefined) {
    engine = factory.factoryPromise.then((record) => {
      const plugin = record.create();
      return isEnginePlugin(plugin) ? plugin : undefined;
    });
    source.engines.set(factory.key, engine);
  }
  const plugin = await engine;
  if (plugin === undefined) {
    throw new Error(`${source.label} cannot run a render in its sandbox.`);
  }
  return plugin;
};

const engineRequest = <R extends EngineRequest>({ filePath, jsReadRoot, ...rest }: R) => ({
  ...rest,
  entryDir: filePath === undefined ? process.cwd() : path.dirname(path.resolve(filePath)),
  jsReadRoot: jsReadRoot ?? process.cwd()
});

/** The folders a render's engine may read, as its script plugin computes them on this host; none it cannot name. */
export const engineReadRoots = async (source: EngineSource, request: EngineRequest): Promise<readonly string[]> => {
  const roots = await (await engineFor(source)).readRoots?.(engineRequest(request));
  if (roots === undefined) {
    throw new Error(`${source.label} names no read roots, so a conversion from its engine cannot be checked.`);
  }
  return roots;
};

/** Runs one render in the engine. */
export const runInEngine = async (
  source: EngineSource,
  request: EngineRequest & {
    method: EngineMethod;
    args: readonly unknown[];
    configs?: HostConfigs;
    configsAbove?: (root: string) => ConfigWithMeta | UnusableConfig | undefined;
  }
): Promise<unknown> => (await engineFor(source)).renderInEngine(engineRequest(request));

/**
 * Starts the engine ahead of a render that may reach a script, so Deno's
 * start overlaps the render in this process. Returns the release for a
 * render that never needed it. A script plugin that cannot start ahead of time,
 * or none at all, gives nothing.
 */
export const prewarmEngine = (source: EngineSource, request: EngineRequest): (() => void) => {
  const engine = engineFor(source).then((plugin) => {
    plugin.prewarmEngine?.({
      ...engineRequest(request),
      extension: request.filePath === undefined ? undefined : path.extname(request.filePath)
    });
    return plugin;
  });
  engine.catch(() => undefined);
  return () => {
    void engine.then(plugin => plugin.releaseEngine?.(), () => undefined);
  };
};

/**
 * Whether a package is installed where a render would resolve it: a
 * `node_modules/<name>` folder above any of `from` (files or `file:` URLs).
 * Asynchronous file checks only, so a project without the package pays no
 * main-thread work to learn so. (`stat`, not `access`: Deno's `access` asks
 * for the `sys` permission, which the engine does not have.)
 */
export const packageInstalled = async (name: string, from: ReadonlyArray<string | URL | undefined>): Promise<boolean> => {
  const dirs = new Set<string>();
  for (const origin of from) {
    if (origin === undefined) {
      continue;
    }
    const file = String(origin).startsWith('file:') ? fileURLToPath(origin) : path.resolve(String(origin));
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
      dirs.add(path.join(dir, 'node_modules', name, 'package.json'));
      if (path.dirname(dir) === dir) {
        break;
      }
    }
  }
  const found = await Promise.all([...dirs].map(file => fs.promises.stat(file).then(() => true, () => false)));
  return found.includes(true);
};

/**
 * Starts the engine ahead of time once `installed` says the script plugin is
 * there; the returned release lets it go, or stops a start still on its way.
 */
export const prewarmWhenInstalled = (installed: Promise<boolean>, start: () => () => void): () => void => {
  let released = false;
  let release: (() => void) | undefined;
  installed.then((yes) => {
    if (yes && !released) {
      release = start();
    }
  }, () => undefined);
  return () => {
    released = true;
    release?.();
  };
};
