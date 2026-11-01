/**
 * Where a render runs (ledger A19, `docs/design/DENO-SANDBOX-COMPILE.md`): in
 * this process, or, once it reaches a stylesheet script, whole in the
 * `@jesscss/plugin-js` Deno engine.
 */
import type { ErrorDiagnostic, PluginInterface, ScriptSandboxRoute, WarningDiagnostic } from '@jesscss/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
};

export type SafeRenderResult = {
  css: string | null;
  errors: ErrorDiagnostic[];
  warnings: WarningDiagnostic[];
};

/** The module and export of a compiler class, so the script sandbox can make the same compiler. */
export type CompilerModuleIdentity = { module: string; exportName: string };

export type EngineMethod = 'render' | 'renderToResult' | 'renderString' | 'safeRender';

/** The script plugin's compile engine (`@jesscss/plugin-js`): one whole render in its Deno sandbox. */
export type EnginePlugin = PluginInterface & {
  renderInEngine(request: {
    compiler: CompilerModuleIdentity;
    compilerOptions: unknown;
    method: EngineMethod;
    args: readonly unknown[];
    entryDir: string;
    jsReadRoot: string;
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
  }
};

const isRenderResultLike = (value: unknown): value is {
  css: unknown;
  loadedUrls?: unknown;
  errors: ErrorDiagnostic[];
  warnings: WarningDiagnostic[];
} => typeof value === 'object' && value !== null
  && isDiagnosticList(Reflect.get(value, 'errors'))
  && isDiagnosticList(Reflect.get(value, 'warnings'));

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
  check: (value: unknown) => T;

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

/** Runs one render in the engine. */
export const runInEngine = async (
  source: EngineSource,
  request: EngineRequest & { method: EngineMethod; args: readonly unknown[] }
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
