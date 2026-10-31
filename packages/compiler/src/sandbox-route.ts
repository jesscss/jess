/**
 * Where a render runs (ledger A19, `docs/design/DENO-SANDBOX-COMPILE.md`): in
 * this process, or, once it reaches a stylesheet script, whole in the
 * `@jesscss/plugin-js` Deno engine.
 */
import type { ErrorDiagnostic, PluginInterface, ScriptSandboxRoute, WarningDiagnostic } from '@jesscss/core';
import * as path from 'node:path';
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
}): Promise<T> => {
  const inEngine = async () => call.check(await call.inEngine());
  if (call.memoKey !== undefined && call.entries.has(call.memoKey)) {
    return inEngine();
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
  const outcome = await Promise.race([inProcess, rerouted]);
  if (outcome !== REROUTED) {
    return outcome;
  }
  if (call.memoKey !== undefined) {
    call.entries.add(call.memoKey);
  }
  return inEngine();
};

/** The script plugin's engine per script-plugin config key: one Deno process each. */
export type EngineCache = Map<string, Promise<EnginePlugin | undefined>>;

/**
 * Runs one render in a script plugin's engine. A script plugin configured by
 * instance runs it under its own options (`jsReadRoot`, `allowHttp`); otherwise
 * the compiler's script plugin, one engine per script-plugin config.
 */
export const runInEngine = async (run: {
  request: {
    compiler: CompilerModuleIdentity;
    compilerOptions: unknown;
    method: EngineMethod;
    args: readonly unknown[];
    filePath: string | undefined;
    jsReadRoot: string | undefined;
  };
  configured: readonly PluginInterface[];
  engines: EngineCache;
  label: string;
  factory: () => { key: string; factoryPromise: Promise<{ create(): PluginInterface }> } | undefined;
}): Promise<unknown> => {
  const { filePath, jsReadRoot, ...rest } = run.request;
  const request = {
    ...rest,
    entryDir: filePath === undefined ? process.cwd() : path.dirname(path.resolve(filePath)),
    jsReadRoot: jsReadRoot ?? process.cwd()
  };
  const configured = run.configured.find(isEnginePlugin);
  if (configured !== undefined) {
    return configured.renderInEngine(request);
  }
  const factory = run.factory();
  if (factory === undefined) {
    throw new Error(`Feature not supported. Install ${run.label} to enable script execution features.`);
  }
  let engine = run.engines.get(factory.key);
  if (engine === undefined) {
    engine = factory.factoryPromise.then((record) => {
      const plugin = record.create();
      return isEnginePlugin(plugin) ? plugin : undefined;
    });
    run.engines.set(factory.key, engine);
  }
  const plugin = await engine;
  if (plugin === undefined) {
    throw new Error(`${run.label} cannot run a render in its sandbox.`);
  }
  return plugin.renderInEngine(request);
};
