import * as path from 'path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import mergeWith from 'lodash-es/mergeWith.js';
import { getConfigWithMeta } from './config.js';
import {
  Context,
  type PrintOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  type JessError,
  toDiagnostic,
  logger,
  type Deprecation
} from '@jesscss/core';
import {
  getOptions,
  type StylesConfig,
  type JavaScriptSandboxConfig,
  type CompileJavaScriptOption
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
type LazyPluginInterface = PluginInterface & { prewarm?: () => Promise<void> };
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
function arrayConcatCustomizer(objValue: any, srcValue: any): any {
  if (isArray(objValue) && isArray(srcValue)) {
    return [...objValue, ...srcValue];
  }
  // Return undefined to use default merge behavior for non-arrays
  return undefined;
}

function stableStringify(value: any): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
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

const require = createRequire(import.meta.url);

const createConsumerRequire = (fromDir?: string) => {
  const baseDir = fromDir ? path.resolve(fromDir) : process.cwd();
  return createRequire(path.join(baseDir, '__jess_consumer__.js'));
};

const resolveFromConsumer = (specifier: string, fromDir?: string): string | undefined => {
  try {
    return createConsumerRequire(fromDir).resolve(specifier);
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND') {
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

  private resolveEffectiveConfig(filePath?: string, renderOptions?: Partial<ConfigOptions>): ResolvedRenderConfig {
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
      } else if (effectiveConfig.output && 'file' in effectiveConfig.output && (effectiveConfig.output as any).file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, (effectiveConfig.output as any).file.replace('{name}', name));
      } else if (renderOptions?.output && !Array.isArray(renderOptions.output) && 'file' in renderOptions.output && (renderOptions.output as any).file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, (renderOptions.output as any).file.replace('{name}', name));
      }
    }
    const lessOptions = getOptions(effectiveConfig, { language: 'less', input: filePath, output: resolvedOutputFilePath });

    const resolveMatchedOutputCollapseNesting = (): boolean | undefined => {
      if (!Array.isArray(effectiveConfig.output) || !resolvedOutputFilePath) {
        return undefined;
      }
      const outputEntries = effectiveConfig.output as Array<Record<string, any>>;
      let defaults: Record<string, any> = {};
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
            return entry.collapseNesting as boolean | undefined;
          }
          if ('collapseNesting' in defaults) {
            return defaults.collapseNesting as boolean | undefined;
          }
          return undefined;
        }
      }
      return undefined;
    };

    const matchedOutputCollapseNesting = resolveMatchedOutputCollapseNesting();
    const explicitOutputCollapseNesting = (
      !Array.isArray(effectiveConfig.output)
        ? (effectiveConfig.output as any)?.collapseNesting
        : undefined
    ) as boolean | undefined;
    const printOptions = {
      collapseNesting: explicitOutputCollapseNesting
        ?? matchedOutputCollapseNesting
        ?? lessOptions.collapseNesting
    };

    return {
      filePath,
      configFilePath,
      effectiveConfig,
      lessOptions,
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
      strictUnits: (lessOptions as any).strictUnits,
      unitMode: lessOptions.unitMode,
      equalityMode: lessOptions.equalityMode,
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
      factoryPromise = import(specifier).then((mod: any) => {
        const pluginFactoryOrInstance = mod?.default ?? mod?.lessCompatPlugin ?? mod?.plugin ?? mod;
        if (typeof pluginFactoryOrInstance === 'function') {
          return {
            name: specifier,
            create: () => {
              const plugin = pluginFactoryOrInstance();
              if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
                throw new Error(`Configured plugin "${specifier}" did not resolve to a valid plugin instance`);
              }
              return plugin as PluginInterface;
            }
          };
        }
        if (!pluginFactoryOrInstance || typeof pluginFactoryOrInstance !== 'object' || typeof pluginFactoryOrInstance.name !== 'string') {
          throw new Error(`Configured plugin "${specifier}" did not resolve to a valid plugin instance`);
        }
        return {
          name: pluginFactoryOrInstance.name,
          create: () => pluginFactoryOrInstance as PluginInterface
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
        pluginPromise = factoryPromise.then(factory => {
          loadedPlugin = factory.create();
          return loadedPlugin;
        });
      }
      return pluginPromise;
    };

    const base: Record<string, any> = {
      name: specifier,
      prewarm: async () => {
        const plugin = await getPlugin();
        if (typeof (plugin as any).prewarm === 'function') {
          await (plugin as any).prewarm();
        }
      }
    };

    return new Proxy(base, {
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
        const value = (loadedPlugin as any)[prop];
        return typeof value === 'function' ? value.bind(loadedPlugin) : value;
      }
    }) as LazyPluginInterface;
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
      factoryPromise = import(pathToFileURL(resolvedSpecifier).href).then((mod: any) => {
        const pluginFactory = (mod?.default ?? mod) as ((opts?: JavaScriptSandboxConfig) => PluginInterface);
        return {
          name: 'js',
          create: () => pluginFactory(jsConfig)
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
        pluginPromise = factoryRecord.factoryPromise.then(factory => {
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
        if (typeof (plugin as any).prewarm === 'function') {
          await (plugin as any).prewarm();
        }
      },
      import: async absoluteFilePath => {
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
        pluginMap.set(plugin.name, plugin as PluginInterface);
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
    const contextOptions = {
      ...resolved.lessOptions,
      ...resolved.effectiveConfig.compile
    };
    if (resolved.normalizedCompileJavaScript) {
      (contextOptions as any).javascript = resolved.jsPluginConfig;
    }
    (contextOptions as any).collapseNesting = resolved.printOptions.collapseNesting;
    (contextOptions as any).output = {
      ...(typeof (resolved.effectiveConfig.output as any) === 'object' && !Array.isArray(resolved.effectiveConfig.output)
        ? (resolved.effectiveConfig.output as any)
        : {}),
      collapseNesting: resolved.printOptions.collapseNesting
    };

    return new Context(contextOptions, plugins);
  }

  private async prepareRender(filePath?: string, renderOptions?: Partial<ConfigOptions>) {
    const profile = createRenderProfile('prepareRender', { filePath });
    const resolved = measureProfileSync(profile, 'resolveEffectiveConfig', () =>
      this.resolveEffectiveConfig(filePath, renderOptions)
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

  private applyPreEvalVisitors(context: Context, tree: any, currentFilePath: string) {
    if (!tree || !context.plugins?.length) {
      return tree;
    }
    let current = tree;
    const processed = new Set<any>();
    for (let pass = 0; pass < 2; pass++) {
      for (const plugin of context.plugins) {
        if (typeof (plugin as any).setContext === 'function') {
          try {
            (plugin as any).setContext(context);
          } catch {
            // ignore
          }
        }
        if (typeof (plugin as any).setCurrentFilePath === 'function') {
          try {
            (plugin as any).setCurrentFilePath(currentFilePath);
          } catch {
            // ignore
          }
        }
        const pre = (plugin as any).preEvalVisitor;
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
          const result = current.accept ? current.accept(visitor) : current;
          if (result) {
            current = result;
          }
          processed.add(visitor);
        }
      }
    }
    return current;
  }

  private applyPostEvalVisitors(context: Context, tree: any) {
    if (!tree || !context.plugins?.length) {
      return tree;
    }
    let current = tree;
    for (const plugin of context.plugins) {
      const post = (plugin as any).postEvalVisitor;
      if (!post) {
        continue;
      }
      const visitors = Array.isArray(post) ? post : [post];
      for (const visitor of visitors) {
        if (!visitor || typeof visitor.visit !== 'function') {
          continue;
        }
        const result = current.accept ? current.accept(visitor) : current;
        if (result) {
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
    context.getTree = async (importPath: string, importOptions: any = {}) => {
      const result = await originalGetTree(importPath, importOptions);
      const resolvedPath = result?.resolvedPath ?? currentFilePathFromImport(importPath, filePath);
      const processedTree = this.applyPreEvalVisitors(context, result.node, resolvedPath);
      if (processedTree && processedTree !== result.node) {
        result.node = processedTree;
        if (result.resolvedPath) {
          context.sourceTrees.set(result.resolvedPath, processedTree as any);
        }
      }
      return result;
    };
  }

  private async prewarmPlugins(context: Context) {
    for (const plugin of context.plugins) {
      if (typeof (plugin as any).prewarm === 'function') {
        await (plugin as any).prewarm();
      }
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
      tree = measureProfileSync(profile, 'applyPreEvalVisitors', () =>
        this.applyPreEvalVisitors(context, parsed.node, filePath ?? '<input>')
      );
    } else {
      const loaded = await measureProfileAsync(profile, 'getTree', () => context.getTree(filePath!));
      tree = measureProfileSync(profile, 'applyPreEvalVisitors', () =>
        this.applyPreEvalVisitors(context, loaded.node, filePath!)
      );
    }

    const evald = await measureProfileAsync(profile, 'eval', () => tree.eval(context));
    return measureProfileSync(profile, 'applyPostEvalVisitors', () =>
      this.applyPostEvalVisitors(context, evald)
    );
  }

  private renderTree(tree: any, context: Context, profile?: RenderProfile): string {
    const printOptions: PrintOptions = {
      collapseNesting: context.opts.collapseNesting,
      context
    };

    let css = measureProfileSync(profile, 'toString', () => tree.toString(printOptions));
    css = measureProfileSync(profile, 'postProcessCss', () => {
      let nextCss = css;
      for (const plugin of context.plugins || []) {
        if (typeof (plugin as any).runPostProcessors === 'function') {
          nextCss = (plugin as any).runPostProcessors(nextCss, {});
        } else if (typeof (plugin as any).postProcessCss === 'function') {
          nextCss = (plugin as any).postProcessCss(nextCss, context);
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
    } catch (err: any) {
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false
        });
      } else {
        logger.error(err.toString());
      }
      finalizeRenderProfile(profile, {
        method: 'compile',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length,
        failed: true,
        errorMessage: err?.message ?? String(err)
      });
      throw err;
    }
  }

  async render(filePath: string, options?: Partial<ConfigOptions>) {
    const { context, profile } = await this.prepareRender(filePath, options);
    try {
      const tree = await this.evaluateInput(context, { filePath }, profile);
      const css = this.renderTree(tree, context, profile);
      finalizeRenderProfile(profile, {
        method: 'render',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return css;
    } catch (err: any) {
      if (!(err && typeof err === 'object' && 'code' in err)) {
        logger.error(err.toString());
      }
      finalizeRenderProfile(profile, {
        method: 'render',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length,
        failed: true,
        errorMessage: err?.message ?? String(err)
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
    const { context, profile } = await this.prepareRender(filePath, renderOptions);

    try {
      const evald = await this.evaluateInput(context, { filePath, source: content, language, extension }, profile);
      const css = this.renderTree(evald, context, profile);
      finalizeRenderProfile(profile, {
        method: 'renderString',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length
      });
      return css;
    } catch (err: any) {
      logger.error(err.toString());
      finalizeRenderProfile(profile, {
        method: 'renderString',
        filePath,
        errors: context.errors.length,
        warnings: context.warnings.length,
        failed: true,
        errorMessage: err?.message ?? String(err)
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
    const { context, profile } = await this.prepareRender(filePath, renderOptions);

    try {
      const evald = await this.evaluateInput(context, {
        filePath,
        source,
        language,
        extension
      }, profile);
      const css = this.renderTree(evald, context, profile);

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
    } catch (err: any) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];

      if (err && typeof err === 'object' && 'severity' in err) {
        const diagnostic = toDiagnostic(err as JessError);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        errors.push({
          code: 'internal/unknown',
          phase: 'eval',
          message: err?.message || 'Unknown error',
          reason: err?.message || 'An unexpected error occurred during compilation.',
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
        errorMessage: err?.message ?? String(err)
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
    } catch (err: any) {
      const errors: ErrorDiagnostic[] = [...context.errors];
      const warnings: WarningDiagnostic[] = [...context.warnings];

      if (err && typeof err === 'object' && 'severity' in err) {
        const diagnostic = toDiagnostic(err as JessError);
        if ('errors' in diagnostic) {
          errors.push(diagnostic);
        } else {
          warnings.push(diagnostic);
        }
      } else {
        errors.push({
          code: 'internal/unknown',
          phase: 'eval',
          message: err?.message || 'Unknown error',
          reason: err?.message || 'An unexpected error occurred during compilation.',
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
        errorMessage: err?.message ?? String(err)
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
    } catch (err: any) {
      const errors: ErrorDiagnostic[] = [{
        code: 'internal/unknown',
        phase: 'eval',
        message: err?.message || 'Unknown error',
        reason: err?.message || 'An unexpected error occurred during rendering.',
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
        plugin.dispose?.();
      } catch {
        // ignore cleanup failures
      }
    }
    for (const plugin of this.lessPluginInstanceCache.values()) {
      try {
        plugin.dispose?.();
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
