import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import mergeWith from 'lodash-es/mergeWith.js';
import { getConfigWithMeta } from './config.js';
import {
  Context,
  type ContextOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  JessError,
  toDiagnostic,
  evalErrorFrameFrom,
  WARN,
  logger,
  Deprecation,
  type WarningsConfigInput,
  type ErrorsConfigInput,
  serialize,
  buildEvaluator
} from '@jesscss/core';
import type { Stylesheet } from '@jesscss/core/ast';
import {
  getOptions,
  applyStrictPreset,
  type StylesConfig,
  type OutputOptions
} from 'styles-config';
import type { PluginInterface } from '@jesscss/core';
import jessPlugin from '@jesscss/plugin-jess';
import lessPlugin from '@jesscss/plugin-less';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';
import scssPlugin from '@jesscss/plugin-scss';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { outputDiagnostics } from './diagnostics.js';

// Built-ins are immutable after assembly. Keep one evaluator for all Compiler
// instances instead of rebuilding its dispatch table on every AST render.
const astValueEvaluator = buildEvaluator(makeBuiltinRegistry());

export type ConfigOptions = StylesConfig & {
  /** Output file path for matching against output config options */
  outputFile?: string;
  /** Suppress warnings (similar to Less's suppressWarnings option) */
  suppressWarnings?: boolean;
  /** Break on first error (stop processing after first error). Default: true */
  breakOnError?: boolean;
  /** Show detailed reason and fix in diagnostics. Default: false */
  verbose?: boolean;
  /** Deprecation warnings of these types will cause an error to be thrown */
  fatalDeprecations?: Iterable<Deprecation>;
  /** Whether to limit repetition of deprecation warnings (max 5). Default: true */
  limitDeprecationRepetition?: boolean;
  /** Warning-display config (scalar tier or object). Default tier: `line`. */
  warnings?: WarningsConfigInput;
  /** Error-display config (scalar tier or object). Default tier: `frame`. */
  errors?: ErrorsConfigInput;
};

const { isArray } = Array;

/**
 * Build the `internal/unknown` diagnostic for a generic (non-`JessError`) error
 * that escaped eval. The eval dispatch stamps the offending node's source span
 * onto such errors; `evalErrorFrameFrom` recovers it so the diagnostic frames
 * the real line/column/source instead of the `1:1`/empty-frame fallback.
 */
function internalUnknownDiagnostic(
  err: unknown,
  errMsg: string,
  filePath: string | undefined,
  fallbackReason: string
): ErrorDiagnostic {
  const frame = evalErrorFrameFrom(err);
  return {
    code: 'internal/unknown',
    phase: 'eval',
    message: errMsg || 'Unknown error',
    reason: errMsg || fallbackReason,
    fix: 'Check the file and ensure it is valid.',
    filePath,
    line: frame?.line ?? 1,
    column: frame?.column ?? 1,
    lines: frame?.lines
  };
}

type LessOptions = ReturnType<typeof getOptions>;
type LessPluginCacheKey = string;
type PluginFactoryCacheKey = string;
type LazyPluginInterface = PluginInterface;
type ProfileMemorySnapshot = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};
type RenderProfile = {
  id: number;
  label: string;
  metadata: Record<string, unknown>;
  startedAtMs: number;
  startedMemory: ProfileMemorySnapshot;
  phases: Array<{
    phase: string;
    durationMs: number;
    memoryDelta: ProfileMemorySnapshot;
  }>;
};

type PluginFactoryRecord = {
  name: string;
  create: (overrideConfig?: JsPluginConfig & { runtimeApi?: 'module' | 'less' }) => PluginInterface;
};

type JsPluginConfig = {
  allowHttp?: boolean;
  allowNetHosts?: string[];
  jsReadRoot?: string;
};

type ResolvedRenderConfig = {
  filePath?: string;
  configFilePath?: string;
  effectiveConfig: ConfigOptions;
  lessOptions: LessOptions;
  activeOptions: Record<string, any>;
  resolvedOutputFilePath?: string;
  jsPluginConfig: JsPluginConfig;
  printOptions: { collapseNesting?: boolean };
};

type RootLessSourceOptions = {
  banner?: string;
  globalVars?: Record<string, unknown> | null;
  modifyVars?: Record<string, unknown> | null;
};

const createBaseConfig = (): ConfigOptions => ({
  compile: {},
  output: {},
  language: {}
});

/**
 * Customizer for mergeWith that concatenates arrays instead of replacing them
 */
function arrayConcatCustomizer(objValue: unknown, srcValue: unknown): unknown {
  if (isArray(objValue) && isArray(srcValue)) {
    return [...objValue, ...srcValue];
  }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (!isObjectRecord(value)) {
    return JSON.stringify(value);
  }
  const entries = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isPluginInterface(value: unknown): value is PluginInterface {
  return isObjectRecord(value) && typeof value.name === 'string';
}

function normalizeLessVariableName(name: string): string {
  return name.startsWith('@') ? name : `@${name}`;
}

function renderLessVariableOverrides(vars: Record<string, unknown> | null | undefined): string {
  if (!vars) {
    return '';
  }
  return Object.entries(vars)
    .map(([name, value]) => `${normalizeLessVariableName(name)}: ${String(value)};`)
    .join('\n');
}

function getLessVariableOverrides(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null;
}

function prepareRootLessSource(source: string, options: RootLessSourceOptions): string {
  const prefix = [
    options.banner,
    renderLessVariableOverrides(options.globalVars)
  ].filter(Boolean).join('\n');
  const suffix = renderLessVariableOverrides(options.modifyVars);

  return [
    prefix,
    source,
    suffix
  ].filter(Boolean).join('\n');
}

function hasRootLessSourceOptions(options: RootLessSourceOptions): boolean {
  return Boolean(
    options.banner
    || (options.globalVars && Object.keys(options.globalVars).length > 0)
    || (options.modifyVars && Object.keys(options.modifyVars).length > 0)
  );
}

function getSearchPaths(options: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(options.searchPaths)) {
    return options.searchPaths.filter((value): value is string => typeof value === 'string');
  }
  if (Array.isArray(options.paths)) {
    return options.paths.filter((value): value is string => typeof value === 'string');
  }
  return undefined;
}

let nextRenderProfileId = 0;

const isProfileEnabled = (): boolean => process.env.JESS_PROFILE === '1';

const nowMs = (): number => Number(process.hrtime.bigint()) / 1_000_000;

const getMemorySnapshot = (): ProfileMemorySnapshot => {
  const { rss, heapTotal, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapTotal, heapUsed, external, arrayBuffers };
};

const diffMemorySnapshot = (
  before: ProfileMemorySnapshot,
  after: ProfileMemorySnapshot
): ProfileMemorySnapshot => ({
  rss: after.rss - before.rss,
  heapTotal: after.heapTotal - before.heapTotal,
  heapUsed: after.heapUsed - before.heapUsed,
  external: after.external - before.external,
  arrayBuffers: after.arrayBuffers - before.arrayBuffers
});

const createRenderProfile = (
  label: string,
  metadata: Record<string, unknown> = {}
): RenderProfile | undefined => {
  if (!isProfileEnabled()) {
    return undefined;
  }
  return {
    id: ++nextRenderProfileId,
    label,
    metadata,
    startedAtMs: nowMs(),
    startedMemory: getMemorySnapshot(),
    phases: []
  };
};

const measureProfileSync = <T>(
  profile: RenderProfile | undefined,
  phase: string,
  fn: () => T
): T => {
  if (!profile) {
    return fn();
  }
  const startedAt = nowMs();
  const startedMemory = getMemorySnapshot();
  try {
    return fn();
  } finally {
    const endedAt = nowMs();
    const endedMemory = getMemorySnapshot();
    profile.phases.push({
      phase,
      durationMs: endedAt - startedAt,
      memoryDelta: diffMemorySnapshot(startedMemory, endedMemory)
    });
  }
};

const measureProfileAsync = async <T>(
  profile: RenderProfile | undefined,
  phase: string,
  fn: () => Promise<T>
): Promise<T> => {
  if (!profile) {
    return fn();
  }
  const startedAt = nowMs();
  const startedMemory = getMemorySnapshot();
  try {
    return await fn();
  } finally {
    const endedAt = nowMs();
    const endedMemory = getMemorySnapshot();
    profile.phases.push({
      phase,
      durationMs: endedAt - startedAt,
      memoryDelta: diffMemorySnapshot(startedMemory, endedMemory)
    });
  }
};

const finalizeRenderProfile = (
  profile: RenderProfile | undefined,
  extraMetadata: Record<string, unknown> = {}
) => {
  if (!profile) {
    return;
  }
  const endedAtMs = nowMs();
  const endedMemory = getMemorySnapshot();
  console.error(
    `[jess-profile] ${JSON.stringify({
      id: profile.id,
      label: profile.label,
      metadata: {
        ...profile.metadata,
        ...extraMetadata
      },
      totalDurationMs: endedAtMs - profile.startedAtMs,
      totalMemoryDelta: diffMemorySnapshot(profile.startedMemory, endedMemory),
      phases: profile.phases
    })}`
  );
};

const createConsumerRequire = (fromDir?: string) => {
  const baseDir = fromDir ? path.resolve(fromDir) : process.cwd();
  return createRequire(path.join(baseDir, '__jess_consumer__.js'));
};

const resolveFromConsumer = (specifier: string, fromDir?: string): string | undefined => {
  try {
    return createConsumerRequire(fromDir).resolve(specifier);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw err;
  }
};

const resolveFromJessPackage = (specifier: string): string | undefined => {
  try {
    return createRequire(import.meta.url).resolve(specifier);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'MODULE_NOT_FOUND') {
      return undefined;
    }
    throw err;
  }
};

const resolvePackageImportEntry = (specifier: string, fromDir?: string): string | undefined => {
  const resolvePackageJson = (requireFrom: NodeRequire) => {
    try {
      return requireFrom.resolve(`${specifier}/package.json`);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'MODULE_NOT_FOUND') {
        return undefined;
      }
      throw err;
    }
  };
  const packageJsonPath = resolvePackageJson(createConsumerRequire(fromDir))
    ?? resolvePackageJson(createRequire(import.meta.url));
  if (!packageJsonPath) {
    return undefined;
  }
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as unknown;
  const moduleEntry = packageJson
    && typeof packageJson === 'object'
    && 'module' in packageJson
    && typeof packageJson.module === 'string'
    ? packageJson.module
    : undefined;
  const rootExport = packageJson
    && typeof packageJson === 'object'
    && 'exports' in packageJson
    && packageJson.exports
    && typeof packageJson.exports === 'object'
    && '.' in packageJson.exports
    ? packageJson.exports['.']
    : undefined;
  const rawImport = rootExport !== null && typeof rootExport === 'object' && 'import' in rootExport
    ? (rootExport as Record<string, unknown>).import
    : undefined;
  const exportImport = typeof rawImport === 'string' ? rawImport : undefined;
  const entry = moduleEntry ?? exportImport;
  if (!entry) {
    return undefined;
  }
  return path.resolve(packageRoot, entry);
};

const resolveJsReadRoot = (
  filePath: string | undefined,
  configFilePath: string | undefined,
  explicitReadRoot: string | undefined
): string => {
  if (explicitReadRoot) {
    return path.resolve(explicitReadRoot);
  }
  const entryRoot = filePath ? path.resolve(path.dirname(filePath)) : undefined;
  const configRoot = configFilePath ? path.resolve(path.dirname(configFilePath)) : undefined;
  if (entryRoot && configRoot) {
    if (entryRoot.startsWith(`${configRoot}${path.sep}`) || entryRoot === configRoot) {
      return configRoot;
    }
    if (configRoot.startsWith(`${entryRoot}${path.sep}`) || configRoot === entryRoot) {
      return entryRoot;
    }
    return configRoot.length < entryRoot.length ? configRoot : entryRoot;
  }
  return entryRoot ?? configRoot ?? process.cwd();
};

const getConsumerResolutionBaseDir = (
  filePath: string | undefined,
  configFilePath: string | undefined
): string | undefined => {
  if (filePath) {
    return path.dirname(filePath);
  }
  if (configFilePath) {
    return path.dirname(configFilePath);
  }
  return process.cwd();
};

export class Compiler {
  /** @internal */
  public opts: ConfigOptions;
  private baseOptsNormalized: ConfigOptions;
  private configuredPluginFactoryCache = new Map<PluginFactoryCacheKey, Promise<PluginFactoryRecord>>();
  private jsPluginFactoryCache = new Map<PluginFactoryCacheKey, Promise<PluginFactoryRecord>>();
  private jsPluginProxyCache = new Map<PluginFactoryCacheKey, LazyPluginInterface>();
  private lessPluginInstanceCache = new Map<LessPluginCacheKey, PluginInterface>();
  private jessPluginInstance: PluginInterface | undefined;
  private scssPluginInstance: PluginInterface | undefined;

  constructor(
    opts: ConfigOptions = {
      compile: {},
      output: {},
      language: {}
    }
  ) {
    this.opts = opts;
    this.baseOptsNormalized = mergeWith(
      createBaseConfig(),
      opts,
      arrayConcatCustomizer
    );
  }

  private resolveEffectiveConfig(
    filePath?: string,
    renderOptions?: Partial<ConfigOptions>,
    parseInput: { language?: string; extension?: string } = {}
  ): ResolvedRenderConfig {
    const { config: loadedFileConfig, configFilePath } = filePath
      ? getConfigWithMeta(path.dirname(filePath))
      : { config: {}, configFilePath: undefined };
    const effectiveConfig: ConfigOptions = mergeWith(
      createBaseConfig(),
      loadedFileConfig,
      this.baseOptsNormalized,
      renderOptions || {},
      arrayConcatCustomizer
    );
    // Expand the `strict` convenience preset once, on the compile config, so the
    // bundle it sets (unitMode/equalityMode/leakyScope/allowOverloadedImport)
    // reaches eval via `context.opts` (contextOptions spreads compile). Individual
    // options already set always win.
    if (effectiveConfig.compile?.strict) {
      effectiveConfig.compile = applyStrictPreset(effectiveConfig.compile);
    }
    const jsPluginConfig: JsPluginConfig = {
      jsReadRoot: resolveJsReadRoot(filePath, configFilePath, effectiveConfig.compile?.jsReadRoot)
    };
    let resolvedOutputFilePath: string | undefined = renderOptions?.outputFile;
    if (!resolvedOutputFilePath) {
      if (Array.isArray(effectiveConfig.output)) {
        // If output is an array, we need the expected output file path to match
      } else if (effectiveConfig.output && !Array.isArray(effectiveConfig.output) && effectiveConfig.output.file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, effectiveConfig.output.file.replace('{name}', name));
      } else if (renderOptions?.output && !Array.isArray(renderOptions.output) && 'file' in renderOptions.output && renderOptions.output.file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, renderOptions.output.file.replace('{name}', name));
      }
    }
    const configInputPath = filePath ?? (
      parseInput.extension
        ? `virtual${parseInput.extension.startsWith('.') ? parseInput.extension : `.${parseInput.extension}`}`
        : undefined
    );
    const lessOptions = getOptions(effectiveConfig, {
      language: 'less',
      input: configInputPath,
      output: resolvedOutputFilePath
    });
    const activeOptions = getOptions(effectiveConfig, {
      language: parseInput.language,
      input: configInputPath,
      output: resolvedOutputFilePath
    });

    // The output `collapseNesting`, honored whether or not an `outputFile`
    // selects a specific array entry. Returns undefined when nothing sets it —
    // the caller falls back to the language default.
    const collapseFromOutput = (): boolean | undefined => {
      const output = effectiveConfig.output;
      if (!Array.isArray(output)) {
        return output?.collapseNesting;
      }
      const isObj = (e: OutputOptions | undefined): e is OutputOptions =>
        !!e && typeof e === 'object';
      const defaults = output.find(e => isObj(e) && !('file' in e));

      if (resolvedOutputFilePath) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        for (const entry of output) {
          if (!isObj(entry) || !('file' in entry)) {
            continue;
          }
          const pattern = String(entry.file ?? '{name}.css');
          if (path.join(dir, pattern.replace('{name}', name)) === resolvedOutputFilePath) {
            if ('collapseNesting' in entry) return entry.collapseNesting;
            return defaults?.collapseNesting;
          }
        }
        return undefined;
      }

      // No target selects an entry. `activeOptions` already absorbs file-less
      // defaults entries (via getMatchingOptions), but not `file`-bearing ones —
      // so honor a file-less default here, else a lone file entry's flag. Stay
      // out of it when several file entries disagree (fall to the default).
      if (defaults && 'collapseNesting' in defaults) {
        return defaults.collapseNesting;
      }
      const flagged = output.filter(e => isObj(e) && 'file' in e && 'collapseNesting' in e);
      return flagged.length === 1 ? flagged[0]!.collapseNesting : undefined;
    };

    const printOptions = {
      collapseNesting: collapseFromOutput() ?? activeOptions.collapseNesting
    };

    return {
      filePath,
      configFilePath,
      effectiveConfig,
      lessOptions,
      activeOptions,
      resolvedOutputFilePath,
      jsPluginConfig,
      printOptions
    };
  }

  private getLessPluginCacheKey(lessOptions: LessOptions): LessPluginCacheKey {
    return stableStringify({
      math: lessOptions.math,
      mathMode: lessOptions.mathMode,
      strictUnits: lessOptions.strictUnits,
      unitMode: lessOptions.unitMode,
      equalityMode: lessOptions.equalityMode,
      allowExtendSelectors: lessOptions.allowExtendSelectors,
      leakyScope: lessOptions.leakyScope,
      bubbleRootAtRules: lessOptions.bubbleRootAtRules,
      collapseNesting: lessOptions.collapseNesting
    });
  }

  private getOrCreateLessPlugin(lessOptions: LessOptions): PluginInterface {
    const key = this.getLessPluginCacheKey(lessOptions);
    let plugin = this.lessPluginInstanceCache.get(key);
    if (!plugin) {
      plugin = lessPlugin(lessOptions);
      this.lessPluginInstanceCache.set(key, plugin);
    }
    return plugin;
  }

  /** The native Jess parser plugin is always available for `.jess` sources. */
  private getOrCreateJessPlugin(): PluginInterface {
    if (!this.jessPluginInstance) {
      this.jessPluginInstance = jessPlugin();
    }
    return this.jessPluginInstance;
  }

  /**
   * The default SCSS plugin. Registered on every render so `.scss` sources parse
   * out of the box (extension routing sends only `.scss` here; `.less`/default
   * still route to the Less plugin). Its own defaults — `unitMode: 'preserve'`,
   * `equalityMode: 'sass'`, nesting preserved — are the SCSS-correct semantics;
   * `allowExtendSelectors` is picked up per-parse from the compiler options.
   * A consumer-configured `scss` plugin in `compile.plugins` overrides this one
   * (same `name` key in `buildPlugins`).
   */
  private getOrCreateScssPlugin(): PluginInterface {
    if (!this.scssPluginInstance) {
      this.scssPluginInstance = scssPlugin();
    }
    return this.scssPluginInstance;
  }

  private getConfiguredPluginFactory(specifier: string): Promise<PluginFactoryRecord> {
    let factoryPromise = this.configuredPluginFactoryCache.get(specifier);
    if (!factoryPromise) {
      factoryPromise = import(specifier).then((mod: Record<string, unknown>) => {
        const pluginFactoryOrInstance = mod.default ?? mod.lessCompatPlugin ?? mod.plugin ?? mod;
        if (typeof pluginFactoryOrInstance === 'function') {
          return {
            name: specifier,
            create: (): PluginInterface => {
              const plugin = pluginFactoryOrInstance();
              if (!isPluginInterface(plugin)) {
                throw new Error(`Configured plugin "${specifier}" did not resolve to a valid plugin instance`);
              }
              return plugin;
            }
          };
        }
        if (!isPluginInterface(pluginFactoryOrInstance)) {
          throw new Error(`Configured plugin "${specifier}" did not resolve to a valid plugin instance`);
        }
        return {
          name: pluginFactoryOrInstance.name,
          create: (): PluginInterface => pluginFactoryOrInstance
        };
      });
      this.configuredPluginFactoryCache.set(specifier, factoryPromise);
    }
    return factoryPromise;
  }

  private createConfiguredPluginProxy(specifier: string): LazyPluginInterface {
    const factoryPromise = this.getConfiguredPluginFactory(specifier);
    let pluginPromise: Promise<PluginInterface> | undefined;
    let loadedPlugin: PluginInterface | undefined;
    const getPlugin = async (): Promise<PluginInterface> => {
      if (!pluginPromise) {
        pluginPromise = factoryPromise.then((factory) => {
          loadedPlugin = factory.create();
          return loadedPlugin;
        });
      }
      return pluginPromise;
    };

    const base: LazyPluginInterface = {
      name: specifier,
      prewarm: async () => {
        const plugin = await getPlugin();
        await plugin.prewarm?.();
      }
    };

    return new Proxy<LazyPluginInterface>(base, {
      get(target, prop, receiver) {
        if (prop === 'name' && loadedPlugin?.name) {
          return loadedPlugin.name;
        }
        if (Reflect.has(target, prop)) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function' ? value.bind(receiver) : value;
        }
        if (!loadedPlugin) {
          return undefined;
        }
        const value = Reflect.get(loadedPlugin, prop, loadedPlugin) as unknown;
        return typeof value === 'function' ? value.bind(loadedPlugin) : value;
      }
    });
  }

  private getJsPluginFactory(
    jsConfig: JsPluginConfig,
    resolutionBaseDir?: string
  ): { key: PluginFactoryCacheKey; factoryPromise: Promise<PluginFactoryRecord>; resolvedSpecifier: string } | undefined {
    const resolvedSpecifier = resolvePackageImportEntry('@jesscss/plugin-js', resolutionBaseDir)
      ?? resolveFromConsumer('@jesscss/plugin-js', resolutionBaseDir)
      ?? resolveFromJessPackage('@jesscss/plugin-js');
    if (!resolvedSpecifier) {
      return undefined;
    }
    const key = stableStringify({
      resolvedSpecifier,
      jsConfig
    });
    let factoryPromise = this.jsPluginFactoryCache.get(key);
    if (!factoryPromise) {
      factoryPromise = import(pathToFileURL(resolvedSpecifier).href).then((mod: Record<string, unknown>) => {
        const pluginFactory = mod.default ?? mod;
        if (typeof pluginFactory !== 'function') {
          throw new Error('@jesscss/plugin-js did not resolve to a plugin factory');
        }
        return {
          name: 'js',
          create: (overrideConfig) => {
            const plugin = pluginFactory(overrideConfig ?? jsConfig);
            if (!isPluginInterface(plugin)) {
              throw new Error('@jesscss/plugin-js did not resolve to a valid plugin instance');
            }
            return plugin;
          }
        };
      });
      this.jsPluginFactoryCache.set(key, factoryPromise);
    }
    return {
      key,
      factoryPromise,
      resolvedSpecifier
    };
  }

  private createJsPluginProxy(
    jsConfig: JsPluginConfig,
    resolutionBaseDir?: string
  ): LazyPluginInterface | undefined {
    const factoryRecord = this.getJsPluginFactory(jsConfig, resolutionBaseDir);
    if (!factoryRecord) {
      return undefined;
    }
    const cachedProxy = this.jsPluginProxyCache.get(factoryRecord.key);
    if (cachedProxy) {
      return cachedProxy;
    }

    let pluginPromise: Promise<PluginInterface> | undefined;
    let loadedPlugin: PluginInterface | undefined;
    let lessPluginPromise: Promise<PluginInterface> | undefined;
    const getPlugin = async (): Promise<PluginInterface> => {
      if (!pluginPromise) {
        pluginPromise = factoryRecord.factoryPromise.then((factory) => {
          loadedPlugin = factory.create();
          return loadedPlugin;
        });
      }
      return pluginPromise;
    };
    const getLessPlugin = async (): Promise<PluginInterface> => {
      if (!lessPluginPromise) {
        lessPluginPromise = factoryRecord.factoryPromise.then(factory =>
          factory.create({
            ...jsConfig,
            runtimeApi: 'less'
          })
        );
      }
      return lessPluginPromise;
    };

    const proxy: LazyPluginInterface = {
      name: 'js',
      supportedExtensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
      import: async (absoluteFilePath) => {
        const plugin = await getPlugin();
        if (!plugin.import) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable script execution features.');
        }
        return plugin.import(absoluteFilePath);
      },
      importLessPlugin: async (absoluteFilePath: string) => {
        const plugin = await getLessPlugin() as PluginInterface & {
          importLessPlugin?: (absoluteFilePath: string, options?: string | null) => Promise<unknown>;
        };
        if (!plugin.importLessPlugin) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable Less @plugin script execution.');
        }
        return plugin.importLessPlugin(absoluteFilePath);
      },
      importPlugin: async (absoluteFilePath: string, options?: string | null) => {
        const plugin = await getLessPlugin() as PluginInterface & {
          importLessPlugin?: (absoluteFilePath: string, options?: string | null) => Promise<unknown>;
        };
        if (!plugin.importLessPlugin) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable executable plugin modules.');
        }
        return plugin.importLessPlugin(absoluteFilePath, options);
      },
      dispose: async () => {
        const plugins = await Promise.all([
          pluginPromise?.catch(() => undefined),
          lessPluginPromise?.catch(() => undefined)
        ]);
        for (const plugin of plugins) {
          await plugin?.dispose?.();
        }
      }
    } as LazyPluginInterface & {
      importLessPlugin(absoluteFilePath: string): Promise<unknown>;
      importPlugin(absoluteFilePath: string, options?: string | null): Promise<unknown>;
    };
    this.jsPluginProxyCache.set(factoryRecord.key, proxy);
    return proxy;
  }

  private buildPlugins(resolved: ResolvedRenderConfig): PluginInterface[] {
    const pluginMap = new Map<string, PluginInterface>();
    const resolutionBaseDir = getConsumerResolutionBaseDir(resolved.filePath, resolved.configFilePath);
    // Node package lookup is a resolver-plugin capability. It must run before
    // generic filesystem resolvers turn a bare specifier into an absolute
    // candidate, while Context continues to own the resolve → locate sequence.
    pluginMap.set('node-modules', nodeModulesPlugin({ basePath: resolutionBaseDir }));
    const coreJessPlugin = this.getOrCreateJessPlugin();
    pluginMap.set(coreJessPlugin.name, coreJessPlugin);
    const coreLessPlugin = this.getOrCreateLessPlugin(resolved.lessOptions);
    pluginMap.set(coreLessPlugin.name, coreLessPlugin);
    const coreScssPlugin = this.getOrCreateScssPlugin();
    pluginMap.set(coreScssPlugin.name, coreScssPlugin);

    const configuredPlugins = resolved.effectiveConfig.compile?.plugins;
    if (configuredPlugins) {
      for (const plugin of configuredPlugins) {
        if (typeof plugin === 'string') {
          if (plugin === '@jesscss/plugin-js') {
            const jsPlugin = this.createJsPluginProxy(resolved.jsPluginConfig, resolutionBaseDir);
            if (jsPlugin) {
              pluginMap.set(jsPlugin.name, jsPlugin);
            }
            continue;
          }
          pluginMap.set(plugin, this.createConfiguredPluginProxy(plugin));
          continue;
        }
        if (!isPluginInterface(plugin)) {
          throw new Error('Configured plugin did not resolve to a valid plugin instance');
        }
        const pluginInstance = plugin;
        if (
          pluginInstance.name === 'less-compat'
          && typeof pluginInstance?.constructor === 'function'
        ) {
          try {
            const opts = isObjectRecord(pluginInstance) ? pluginInstance.opts : undefined;
            const freshPlugin: unknown = Reflect.construct(pluginInstance.constructor, [opts]);
            if (isPluginInterface(freshPlugin)) {
              pluginMap.set(freshPlugin.name, freshPlugin);
              continue;
            }
          } catch {
            // Fall through to using the provided plugin instance directly.
          }
        }
        pluginMap.set(plugin.name, plugin);
      }
    }

    if (pluginMap.has('js')) {
      try {
        const consumerRequire = createConsumerRequire(resolutionBaseDir);
        consumerRequire('@jesscss/plugin-js');
      } catch {
        // optional: plugin-js may be missing; @plugin will throw at runtime if used
      }
    }

    return [...pluginMap.values()];
  }

  private createContextFromResolved(resolved: ResolvedRenderConfig, plugins: PluginInterface[]): Context {
    const searchPaths = getSearchPaths(resolved.activeOptions)
      ?? getSearchPaths(resolved.effectiveConfig.compile ?? {});
    const contextOptions: ContextOptions & Record<string, unknown> = {
      ...resolved.effectiveConfig.compile,
      ...resolved.activeOptions,
      ...(searchPaths ? { searchPaths } : {})
    };
    // Auto-wire @jesscss/plugin-js when it is resolvable: Less `@plugin` and
    // script-module imports lazily request an importer for the JS/TS extension
    // via `loadPluginForExtension`. When plugin-js is absent, the proxy factory
    // returns undefined and core emits the "Install @jesscss/plugin-js" gate.
    // A user-configured `loadPluginForExtension` (if any) still wins.
    const userLoadPluginForExtension = contextOptions.loadPluginForExtension;
    const resolutionBaseDir = getConsumerResolutionBaseDir(resolved.filePath, resolved.configFilePath);
    const autoWireJsPlugin = (extension: string): PluginInterface | undefined => {
      const jsPlugin = this.createJsPluginProxy(resolved.jsPluginConfig, resolutionBaseDir);
      if (jsPlugin?.supportedExtensions?.includes(extension)) {
        return jsPlugin;
      }
      return undefined;
    };
    contextOptions.loadPluginForExtension = (extension: string) => {
      if (!userLoadPluginForExtension) {
        return autoWireJsPlugin(extension);
      }
      const fromUser = userLoadPluginForExtension(extension);
      if (fromUser && typeof (fromUser as Promise<unknown>).then === 'function') {
        return Promise.resolve(fromUser).then(resolvedPlugin => resolvedPlugin ?? autoWireJsPlugin(extension));
      }
      return (fromUser as PluginInterface | undefined) ?? autoWireJsPlugin(extension);
    };

    // `breakOnError` is a top-level render option (consumed by outputDiagnostics for
    // display), but eval-time collection-vs-throw also reads it off `context.opts`
    // (Context.getTree / the spine import fold). Thread it through so a render called
    // with `breakOnError: false` actually COLLECTS parse/resolution failures instead
    // of hard-throwing out of the whole render.
    if (resolved.effectiveConfig.breakOnError !== undefined) {
      contextOptions.breakOnError = resolved.effectiveConfig.breakOnError;
    }
    const usesDeprecatedDisablePluginRule = Boolean(contextOptions.disablePluginRule);
    contextOptions.disableScriptModules = Boolean(
      contextOptions.disableScriptModules
      || contextOptions.disablePluginRule
    );
    const cfgOutput = typeof resolved.effectiveConfig.output === 'object' && !Array.isArray(resolved.effectiveConfig.output)
      ? resolved.effectiveConfig.output
      : null;
    contextOptions.output = {
      compress: cfgOutput?.compress,
      sourceMap: typeof cfgOutput?.sourceMap === 'boolean' ? cfgOutput.sourceMap : Boolean(cfgOutput?.sourceMap),
      collapseNesting: resolved.printOptions.collapseNesting
    };

    const context = new Context(contextOptions, plugins);
    context.valueEvaluator = astValueEvaluator;
    if (usesDeprecatedDisablePluginRule) {
      context.warnings.push(toDiagnostic(WARN.deprecated({
        filePath: resolved.filePath,
        meta: {
          what: 'disablePluginRule',
          use: 'disableScriptModules',
          deprecation: Deprecation.fromId('disable-plugin-rule-option') ?? Deprecation.userAuthored
        }
      })));
    }
    return context;
  }

  private async prepareRender(
    filePath?: string,
    renderOptions?: Partial<ConfigOptions>,
    parseInput?: { language?: string; extension?: string }
  ) {
    const profile = createRenderProfile('prepareRender', { filePath });
    const resolved = measureProfileSync(profile, 'resolveEffectiveConfig', () =>
      this.resolveEffectiveConfig(filePath, renderOptions, parseInput)
    );
    const plugins = measureProfileSync(profile, 'buildPlugins', () =>
      this.buildPlugins(resolved)
    );
    const context = measureProfileSync(profile, 'createContextFromResolved', () =>
      this.createContextFromResolved(resolved, plugins)
    );
    return { resolved, plugins, context, profile };
  }

  /**
   * Create a context with the configured plugins
   *
   * @internal
   */
  createContext(filePath?: string, renderOptions?: Partial<ConfigOptions>): Context {
    const resolved = this.resolveEffectiveConfig(filePath, renderOptions);
    const plugins = this.buildPlugins(resolved);
    return this.createContextFromResolved(resolved, plugins);
  }

  private async prewarmPlugins(context: Context) {
    for (const plugin of context.plugins) {
      await plugin.prewarm?.();
    }
  }

  /** Parse the source once through the Context-selected AST plugin. */
  private async prepareStylesheet(
    context: Context,
    resolved: ResolvedRenderConfig,
    input: { filePath?: string; source?: string; language?: string; extension?: string },
    profile?: RenderProfile
  ): Promise<Stylesheet> {
    const { filePath, source, language, extension } = input;
    const rootLessSourceOptions: RootLessSourceOptions = {
      banner: typeof resolved.activeOptions.banner === 'string'
        ? resolved.activeOptions.banner
        : undefined,
      globalVars: getLessVariableOverrides(resolved.activeOptions.globalVars),
      modifyVars: getLessVariableOverrides(resolved.activeOptions.modifyVars)
    };
    const shouldPrepareRootLessSource = hasRootLessSourceOptions(rootLessSourceOptions);

    await measureProfileAsync(profile, 'prewarmPlugins', () => this.prewarmPlugins(context));

    if (source != null) {
      const preparedSource = shouldPrepareRootLessSource
        ? prepareRootLessSource(source, rootLessSourceOptions)
        : source;
      const parsed = await measureProfileAsync(profile, 'parseString', () =>
        context.parseString(preparedSource, {
          filePath,
          type: language,
          extension
        })
      );
      return parsed.node;
    } else {
      const loaded = shouldPrepareRootLessSource
        ? await measureProfileAsync(profile, 'getPreparedRootTree', async () => {
            const { resolvedPath } = await context.resolveImportPath(filePath!);
            const sourceGetter = context.plugins.find(plugin => plugin.getSource);
            if (!sourceGetter?.getSource) {
              throw new Error('No source getter found');
            }
            const rootSource = await sourceGetter.getSource(resolvedPath);
            const preparedSource = prepareRootLessSource(rootSource, rootLessSourceOptions);
            const parsed = await context.parseString(preparedSource, {
              filePath: resolvedPath,
              type: language,
              extension
            });
            if (parsed.node) {
              context.sourceTrees.set(resolvedPath, parsed.node);
            }
            return parsed;
          })
        : await measureProfileAsync(profile, 'getTree', () => context.getTree(filePath!));
      if (!loaded.node) {
        throw new Error(`Failed to load ${filePath!}`);
      }
      return loaded.node;
    }
  }

  private async renderStylesheet(document: Stylesheet, context: Context, profile?: RenderProfile): Promise<string> {
    for (const plugin of context.plugins) plugin.setContext?.(context);
    const result = await measureProfileAsync(profile, 'renderAstStylesheet', () =>
      Promise.resolve(context.withDocument(document, () => serialize(document, {
        collapseNesting: context.opts.output?.collapseNesting ?? false,
        context,
        pluginHost: context.pluginHost,
        io: { readFile: specifier => context.readBinary(specifier).catch(() => null) },
      })))
    );
    let css = result.css;
    for (const plugin of context.plugins || []) {
      if (plugin.runPostProcessors) {
        css = plugin.runPostProcessors(css, {});
      } else if (plugin.postProcessCss) {
        css = plugin.postProcessCss(css, context);
      }
    }
    return css;
  }

  /** @internal AST document preparation; no legacy evaluator tree is exposed. */
  async compile(filePath: string, options?: Partial<ConfigOptions>) {
    const { resolved, context, profile } = await this.prepareRender(filePath, options);

    try {
      const document = await this.prepareStylesheet(context, resolved, { filePath }, profile);

      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false,
          warnings: options?.warnings,
          errors: options?.errors
        });
      }

      finalizeRenderProfile(profile, {
        method: 'compile',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return { document, context };
    } catch (err: unknown) {
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false,
          warnings: options?.warnings,
          errors: options?.errors
        });
      } else {
        logger.error(String(err));
      }
      finalizeRenderProfile(profile, {
        method: 'compile',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length,
        failed: true,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  async render(filePath: string, options?: Partial<ConfigOptions>) {
    const { resolved, context, profile } = await this.prepareRender(filePath, options);
    try {
      const input = { filePath };
      const css = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile
      );
      finalizeRenderProfile(profile, {
        method: 'render',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return css;
    } catch (err: unknown) {
      if (!(err && typeof err === 'object' && 'code' in err)) {
        logger.error(String(err));
      }
      finalizeRenderProfile(profile, {
        method: 'render',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length,
        failed: true,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  async renderString(content: string, options: {
    filePath?: string;
    language?: string;
    extension?: string;
    config?: Partial<ConfigOptions>;
  } = {}) {
    const { filePath, language, extension, config: renderOptions } = options;
    const { resolved, context, profile } = await this.prepareRender(filePath, renderOptions, { language, extension });

    try {
      const input = { filePath, source: content, language, extension };
      const css = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile
      );
      finalizeRenderProfile(profile, {
        method: 'renderString',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return css;
    } catch (err: unknown) {
      logger.error(String(err));
      finalizeRenderProfile(profile, {
        method: 'renderString',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length,
        failed: true,
        errorMessage: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  async renderToResult(
    input: string | { source: string; filePath?: string; language?: string; extension?: string },
    options?: Partial<ConfigOptions> & {
      filePath?: string;
      language?: string;
      extension?: string;
    }
  ): Promise<{
    css: string;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
    loadedUrls: string[];
  }> {
    const isSourceContent = typeof input === 'object' && 'source' in input;
    const source = isSourceContent ? input.source : undefined;
    const filePath = isSourceContent ? input.filePath : input;
    const language = isSourceContent ? input.language : options?.language;
    const extension = isSourceContent ? input.extension : options?.extension;
    const renderOptions = options;
    const { resolved, context, profile } = await this.prepareRender(filePath, renderOptions, { language, extension });

    try {
      const input = { filePath, source, language, extension };
      const css = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile
      );

      context.finalizeWarnings();

      const loadedUrls: string[] = [];

      finalizeRenderProfile(profile, {
        method: 'renderToResult',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return {
        css,
        errors: [...context.errors],
        warnings: [...context.warnings],
        loadedUrls
      };
    } catch (err: unknown) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];
      const errMsg = err instanceof Error ? err.message : String(err);

      if (err instanceof JessError) {
        const diagnostic = toDiagnostic(err);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        errors.push(internalUnknownDiagnostic(
          err,
          errMsg,
          filePath ?? undefined,
          'An unexpected error occurred during compilation.'
        ));
      }

      if (renderOptions?.suppressWarnings !== true) {
        outputDiagnostics(errors, warnings, {
          suppressWarnings: renderOptions?.suppressWarnings ?? false,
          breakOnError: renderOptions?.breakOnError ?? true,
          verbose: renderOptions?.verbose ?? false,
          warnings: renderOptions?.warnings,
          errors: renderOptions?.errors
        });
      }

      const loadedUrls: string[] = [];
      finalizeRenderProfile(profile, {
        method: 'renderToResult',
        filePath,
        errors: errors.length,
        warnings: warnings.length,
        failed: true,
        errorMessage: errMsg
      });
      return {
        css: '',
        errors,
        warnings,
        loadedUrls
      };
    }
  }

  /** @internal */
  async safeCompile(filePath: string, options?: Partial<ConfigOptions>): Promise<{
    document: Stylesheet | null;
    context: Context;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
  }> {
    const { resolved, context, profile } = await this.prepareRender(filePath, {
      ...options,
      breakOnError: false,
      suppressWarnings: options?.suppressWarnings ?? false
    });

    try {
      const document = await this.prepareStylesheet(context, resolved, { filePath }, profile);

      context.finalizeWarnings();

      finalizeRenderProfile(profile, {
        method: 'safeCompile',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return {
        document,
        context,
        errors: [...context.errors],
        warnings: [...context.warnings]
      };
    } catch (err: unknown) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];
      const errMsg = err instanceof Error ? err.message : String(err);

      if (err instanceof JessError) {
        const diagnostic = toDiagnostic(err);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        errors.push(internalUnknownDiagnostic(
          err,
          errMsg,
          filePath,
          'An unexpected error occurred during compilation.'
        ));
      }

      finalizeRenderProfile(profile, {
        method: 'safeCompile',
        filePath,
        errors: errors.length,
        warnings: warnings.length,
        failed: true,
        errorMessage: errMsg
      });
      return { document: null, context, errors, warnings };
    }
  }

  /** @internal */
  async safeRender(filePath: string, options?: Partial<ConfigOptions>): Promise<{
    css: string | null;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
  }> {
    const { resolved, context, profile } = await this.prepareRender(filePath, {
      ...options,
      breakOnError: false,
      suppressWarnings: options?.suppressWarnings ?? false
    });

    try {
      const input = { filePath };
      const css = await this.renderStylesheet(
        await this.prepareStylesheet(context, resolved, input, profile),
        context,
        profile
      );

      finalizeRenderProfile(profile, {
        method: 'safeRender',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return {
        css,
        errors: [...context.errors],
        warnings: [...context.warnings]
      };
    } catch (err: unknown) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];
      const errMsg = err instanceof Error ? err.message : String(err);

      if (err instanceof JessError) {
        const diagnostic = toDiagnostic(err);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        errors.push(internalUnknownDiagnostic(
          err,
          errMsg,
          filePath,
          'An unexpected error occurred during rendering.'
        ));
      }

      finalizeRenderProfile(profile, {
        method: 'safeRender',
        filePath,
        errors: errors.length,
        warnings: warnings.length,
        failed: true,
        errorMessage: errMsg
      });
      return { css: null, errors, warnings };
    }
  }

  dispose() {
    for (const plugin of this.jsPluginProxyCache.values()) {
      try {
        void plugin.dispose?.();
      } catch {
        // ignore cleanup failures
      }
    }
    for (const plugin of this.lessPluginInstanceCache.values()) {
      try {
        void plugin.dispose?.();
      } catch {
        // ignore cleanup failures
      }
    }
    try {
      void this.scssPluginInstance?.dispose?.();
    } catch {
      // ignore cleanup failures
    }
    this.jsPluginProxyCache.clear();
    this.jsPluginFactoryCache.clear();
    this.lessPluginInstanceCache.clear();
    this.jessPluginInstance = undefined;
    this.scssPluginInstance = undefined;
    this.configuredPluginFactoryCache.clear();
  }
}
