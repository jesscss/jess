import * as path from 'path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import mergeWith from 'lodash-es/mergeWith.js';
import { getConfigWithMeta } from './config.js';
import {
  Context,
  Rules,
  type ContextOptions,
  type PrintOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  JessError,
  toDiagnostic,
  logger,
  type Deprecation,
  renderNodeToString
} from '@jesscss/core';
import {
  getOptions,
  type StylesConfig,
  type JavaScriptSandboxConfig,
  type CompileJavaScriptOption,
  type OutputOptions
} from 'styles-config';
import type { PluginInterface } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { outputDiagnostics } from './diagnostics.js';

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
};

const { isArray } = Array;

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
  create: () => PluginInterface;
};

type ResolvedRenderConfig = {
  filePath?: string;
  configFilePath?: string;
  effectiveConfig: ConfigOptions;
  lessOptions: LessOptions;
  activeOptions: Record<string, any>;
  resolvedOutputFilePath?: string;
  jsPluginConfig: JavaScriptSandboxConfig;
  normalizedCompileJavaScript?: JavaScriptSandboxConfig;
  printOptions: { collapseNesting?: boolean };
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

const normalizeCompileJavaScript = (
  javascript: CompileJavaScriptOption | undefined
): JavaScriptSandboxConfig | undefined => {
  if (javascript === true) {
    return {};
  }
  if (!javascript || typeof javascript !== 'object') {
    return undefined;
  }
  return javascript;
};

const resolveJsReadRoot = (
  jsConfig: JavaScriptSandboxConfig | undefined,
  filePath: string | undefined,
  configFilePath: string | undefined
): string => {
  if (jsConfig?.jsReadRoot) {
    return path.resolve(jsConfig.jsReadRoot);
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
  private baseOptsNormalized: ConfigOptions;
  private configuredPluginFactoryCache = new Map<PluginFactoryCacheKey, Promise<PluginFactoryRecord>>();
  private jsPluginFactoryCache = new Map<PluginFactoryCacheKey, Promise<PluginFactoryRecord>>();
  private jsPluginProxyCache = new Map<PluginFactoryCacheKey, LazyPluginInterface>();
  private lessPluginInstanceCache = new Map<LessPluginCacheKey, PluginInterface>();

  constructor(
    public opts: ConfigOptions = {
      compile: {},
      output: {},
      language: {}
    }
  ) {
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
    const normalizedCompileJavaScript = normalizeCompileJavaScript(effectiveConfig.compile?.javascript);
    const resolvedJsReadRoot = resolveJsReadRoot(normalizedCompileJavaScript, filePath, configFilePath);
    const jsPluginConfig: JavaScriptSandboxConfig = {
      ...(normalizedCompileJavaScript ?? {}),
      jsReadRoot: normalizedCompileJavaScript?.jsReadRoot
        ? path.resolve(normalizedCompileJavaScript.jsReadRoot)
        : resolvedJsReadRoot
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

    const resolveMatchedOutputCollapseNesting = (): boolean | undefined => {
      if (!Array.isArray(effectiveConfig.output) || !resolvedOutputFilePath) {
        return undefined;
      }
      const outputEntries = effectiveConfig.output as OutputOptions[];
      let defaults: OutputOptions = {};
      if (outputEntries[0] && typeof outputEntries[0] === 'object' && !('file' in outputEntries[0])) {
        defaults = outputEntries[0]!;
      }
      const dir = filePath ? path.dirname(filePath) : '.';
      const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
      for (const entry of outputEntries) {
        if (!entry || typeof entry !== 'object' || !('file' in entry)) {
          continue;
        }
        const filePattern = String(entry.file ?? '{name}.css');
        const expandedPath = path.join(dir, filePattern.replace('{name}', name));
        if (expandedPath === resolvedOutputFilePath) {
          if ('collapseNesting' in entry) {
            return entry.collapseNesting;
          }
          if ('collapseNesting' in defaults) {
            return defaults.collapseNesting;
          }
          return undefined;
        }
      }
      return undefined;
    };

    const matchedOutputCollapseNesting = resolveMatchedOutputCollapseNesting();
    const explicitOutputCollapseNesting: boolean | undefined =
      !Array.isArray(effectiveConfig.output)
        ? effectiveConfig.output?.collapseNesting
        : undefined;
    const printOptions = {
      collapseNesting: explicitOutputCollapseNesting
        ?? matchedOutputCollapseNesting
        ?? activeOptions.collapseNesting
    };

    return {
      filePath,
      configFilePath,
      effectiveConfig,
      lessOptions,
      activeOptions,
      resolvedOutputFilePath,
      jsPluginConfig,
      normalizedCompileJavaScript,
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
      leakyRules: lessOptions.leakyRules,
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
          return Reflect.get(target, prop, receiver);
        }
        if (!loadedPlugin) {
          return undefined;
        }
        const value = Reflect.get(loadedPlugin, prop, loadedPlugin);
        return typeof value === 'function' ? value.bind(loadedPlugin) : value;
      }
    });
  }

  private getJsPluginFactory(
    jsConfig: JavaScriptSandboxConfig,
    resolutionBaseDir?: string
  ): { key: PluginFactoryCacheKey; factoryPromise: Promise<PluginFactoryRecord>; resolvedSpecifier: string } | undefined {
    const resolvedSpecifier = resolveFromConsumer('@jesscss/plugin-js', resolutionBaseDir);
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
          create: () => {
            const plugin = pluginFactory(jsConfig);
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
    jsConfig: JavaScriptSandboxConfig,
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
    const getPlugin = async (): Promise<PluginInterface> => {
      if (!pluginPromise) {
        pluginPromise = factoryRecord.factoryPromise.then((factory) => {
          loadedPlugin = factory.create();
          return loadedPlugin;
        });
      }
      return pluginPromise;
    };

    const proxy: LazyPluginInterface = {
      name: 'js',
      supportedExtensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
      prewarm: async () => {
        const plugin = await getPlugin();
        await plugin.prewarm?.();
      },
      import: async (absoluteFilePath) => {
        const plugin = await getPlugin();
        if (!plugin.import) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable script execution features.');
        }
        return plugin.import(absoluteFilePath);
      }
    };
    this.jsPluginProxyCache.set(factoryRecord.key, proxy);
    return proxy;
  }

  private buildPlugins(resolved: ResolvedRenderConfig): PluginInterface[] {
    const pluginMap = new Map<string, PluginInterface>();
    const coreLessPlugin = this.getOrCreateLessPlugin(resolved.lessOptions);
    pluginMap.set(coreLessPlugin.name, coreLessPlugin);
    const resolutionBaseDir = getConsumerResolutionBaseDir(resolved.filePath, resolved.configFilePath);

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

    if (!pluginMap.has('js')) {
      const jsPlugin = this.createJsPluginProxy(resolved.jsPluginConfig, resolutionBaseDir);
      if (jsPlugin) {
        pluginMap.set(jsPlugin.name, jsPlugin);
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
    const contextOptions: ContextOptions & Record<string, unknown> = {
      ...resolved.effectiveConfig.compile,
      ...resolved.activeOptions
    };
    if (resolved.normalizedCompileJavaScript) {
      contextOptions.javascript = resolved.jsPluginConfig;
    }
    contextOptions.collapseNesting = resolved.printOptions.collapseNesting;
    contextOptions.output = {
      ...(typeof resolved.effectiveConfig.output === 'object' && !Array.isArray(resolved.effectiveConfig.output)
        ? resolved.effectiveConfig.output
        : {}),
      collapseNesting: resolved.printOptions.collapseNesting
    };

    return new Context(contextOptions, plugins);
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
   */
  createContext(filePath?: string, renderOptions?: Partial<ConfigOptions>): Context {
    const resolved = this.resolveEffectiveConfig(filePath, renderOptions);
    const plugins = this.buildPlugins(resolved);
    return this.createContextFromResolved(resolved, plugins);
  }

  private applyPreEvalVisitors(context: Context, tree: Rules, currentFilePath: string): Rules {
    if (!tree || !context.plugins?.length) {
      return tree;
    }
    let current = tree;
    const processed = new Set<unknown>();
    for (let pass = 0; pass < 2; pass++) {
      for (const plugin of context.plugins) {
        if (plugin.setContext) {
          try {
            plugin.setContext(context);
          } catch {
            // ignore
          }
        }
        if (plugin.setCurrentFilePath) {
          try {
            plugin.setCurrentFilePath(currentFilePath);
          } catch {
            // ignore
          }
        }
        const pre = plugin.preEvalVisitor;
        if (!pre) {
          continue;
        }
        const visitors = Array.isArray(pre) ? pre : [pre];
        for (const visitor of visitors) {
          if (!visitor || typeof visitor.visit !== 'function') {
            continue;
          }
          if (pass === 1 && processed.has(visitor)) {
            continue;
          }
          const result = current.accept(visitor);
          if (result instanceof Rules) {
            current = result;
          }
          processed.add(visitor);
        }
      }
    }
    return current;
  }

  private applyPreRenderVisitors(context: Context, tree: Rules): Rules {
    if (!tree || !context.plugins?.length) {
      return tree;
    }
    let current = tree;
    for (const plugin of context.plugins) {
      const post = plugin.postEvalVisitor;
      if (!post) {
        continue;
      }
      const visitors = Array.isArray(post) ? post : [post];
      for (const visitor of visitors) {
        if (!visitor || typeof visitor.visit !== 'function') {
          continue;
        }
        const result = current.accept(visitor);
        if (result instanceof Rules) {
          current = result;
        }
      }
    }
    return current;
  }

  private attachImportVisitorHook(context: Context, filePath: string) {
    const currentFilePathFromImport = (importPath: string, fallback: string) => {
      return typeof importPath === 'string' && importPath.length ? importPath : fallback;
    };

    const originalGetTree = context.getTree.bind(context);
    context.getTree = async (importPath: string, importOptions = {}) => {
      const result = await originalGetTree(importPath, importOptions);
      if (!result.node) {
        return result;
      }
      const resolvedPath = result?.resolvedPath ?? currentFilePathFromImport(importPath, filePath);
      const processedTree = this.applyPreEvalVisitors(context, result.node, resolvedPath);
      if (processedTree && processedTree !== result.node) {
        result.node = processedTree;
        if (result.resolvedPath) {
          context.sourceTrees.set(result.resolvedPath, processedTree);
        }
      }
      return result;
    };
  }

  private async prewarmPlugins(context: Context) {
    for (const plugin of context.plugins) {
      await plugin.prewarm?.();
    }
  }

  private async evaluateInput(
    context: Context,
    input: { filePath?: string; source?: string; language?: string; extension?: string },
    profile?: RenderProfile
  ) {
    const { filePath, source, language, extension } = input;

    if (filePath) {
      this.attachImportVisitorHook(context, filePath);
    }

    await measureProfileAsync(profile, 'prewarmPlugins', () => this.prewarmPlugins(context));

    let tree;
    if (source != null) {
      const parsed = await measureProfileAsync(profile, 'parseString', () =>
        context.parseString(source, {
          filePath,
          type: language,
          extension
        })
      );
      const parsedNode = parsed.node;
      if (!parsedNode) {
        throw new Error(`Failed to parse ${filePath ?? '<input>'}`);
      }
      tree = measureProfileSync(profile, 'applyPreEvalVisitors', () =>
        this.applyPreEvalVisitors(context, parsedNode, filePath ?? '<input>')
      );
    } else {
      const loaded = await measureProfileAsync(profile, 'getTree', () => context.getTree(filePath!));
      const loadedNode = loaded.node;
      if (!loadedNode) {
        throw new Error(`Failed to load ${filePath!}`);
      }
      tree = measureProfileSync(profile, 'applyPreEvalVisitors', () =>
        this.applyPreEvalVisitors(context, loadedNode, filePath!)
      );
    }

    const evald = await measureProfileAsync(profile, 'eval', async () => tree.eval(context));
    return measureProfileSync(profile, 'applyPreRenderVisitors', () =>
      this.applyPreRenderVisitors(context, evald)
    );
  }

  private async renderTree(tree: any, context: Context, profile?: RenderProfile): Promise<string> {
    const printOptions: PrintOptions = {
      collapseNesting: context.opts.collapseNesting,
      context
    };

    let css = await measureProfileAsync(profile, 'render', async () => renderNodeToString(tree, context, printOptions));
    css = measureProfileSync(profile, 'postProcessCss', () => {
      let nextCss = css;
      for (const plugin of context.plugins || []) {
        if (plugin.runPostProcessors) {
          nextCss = plugin.runPostProcessors(nextCss, {});
        } else if (plugin.postProcessCss) {
          nextCss = plugin.postProcessCss(nextCss, context);
        }
      }
      return nextCss;
    });
    return css;
  }

  async compile(filePath: string, options?: Partial<ConfigOptions>) {
    const { context, profile } = await this.prepareRender(filePath, options);

    try {
      const postEvald = await this.evaluateInput(context, { filePath }, profile);

      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false
        });
      }

      finalizeRenderProfile(profile, {
        method: 'compile',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return { tree: postEvald, context };
    } catch (err: unknown) {
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false
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
    const { context, profile } = await this.prepareRender(filePath, options);
    try {
      const tree = await this.evaluateInput(context, { filePath }, profile);
      const css = await this.renderTree(tree, context, profile);
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
    const { context, profile } = await this.prepareRender(filePath, renderOptions, { language, extension });

    try {
      const evald = await this.evaluateInput(context, { filePath, source: content, language, extension }, profile);
      const css = await this.renderTree(evald, context, profile);
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
    const { context, profile } = await this.prepareRender(filePath, renderOptions, { language, extension });

    try {
      const evald = await this.evaluateInput(context, {
        filePath,
        source,
        language,
        extension
      }, profile);
      const css = await this.renderTree(evald, context, profile);

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
        errors.push({
          code: 'internal/unknown',
          phase: 'eval',
          message: errMsg || 'Unknown error',
          reason: errMsg || 'An unexpected error occurred during compilation.',
          fix: 'Check the file and ensure it is valid.',
          filePath: filePath ?? undefined,
          line: 1,
          column: 1
        });
      }

      if (renderOptions?.suppressWarnings !== true) {
        outputDiagnostics(errors, warnings, {
          suppressWarnings: renderOptions?.suppressWarnings ?? false,
          breakOnError: renderOptions?.breakOnError ?? true,
          verbose: renderOptions?.verbose ?? false
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

  async safeCompile(filePath: string, options?: Partial<ConfigOptions>): Promise<{
    tree: any | null;
    context: Context;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
  }> {
    const { context, profile } = await this.prepareRender(filePath, {
      ...options,
      breakOnError: false,
      suppressWarnings: options?.suppressWarnings ?? false
    });

    try {
      const evald = await this.evaluateInput(context, { filePath }, profile);

      finalizeRenderProfile(profile, {
        method: 'safeCompile',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return {
        tree: evald,
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
        errors.push({
          code: 'internal/unknown',
          phase: 'eval',
          message: errMsg || 'Unknown error',
          reason: errMsg || 'An unexpected error occurred during compilation.',
          fix: 'Check the file and ensure it is valid.',
          filePath,
          line: 1,
          column: 1
        });
      }

      finalizeRenderProfile(profile, {
        method: 'safeCompile',
        filePath,
        errors: errors.length,
        warnings: warnings.length,
        failed: true,
        errorMessage: errMsg
      });
      return { tree: null, context, errors, warnings };
    }
  }

  async safeRender(filePath: string, options?: Partial<ConfigOptions>): Promise<{
    css: string | null;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
  }> {
    try {
      const { tree, errors, warnings } = await this.safeCompile(filePath, options);

      if (!tree) {
        return { css: null, errors, warnings };
      }

      const printOptions: PrintOptions = {
        collapseNesting: tree.context?.opts.collapseNesting,
        context: tree.context
      };

      const css = tree.toString(printOptions);
      return { css, errors, warnings };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errors: ErrorDiagnostic[] = [{
        code: 'internal/unknown',
        phase: 'eval',
        message: errMsg || 'Unknown error',
        reason: errMsg || 'An unexpected error occurred during rendering.',
        fix: 'Check the file and ensure it is valid.',
        filePath,
        line: 1,
        column: 1
      }];
      return { css: null, errors, warnings: [] };
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
    this.jsPluginProxyCache.clear();
    this.jsPluginFactoryCache.clear();
    this.lessPluginInstanceCache.clear();
    this.configuredPluginFactoryCache.clear();
  }
}
