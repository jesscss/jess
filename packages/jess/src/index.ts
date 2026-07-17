import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import mergeWith from 'lodash-es/mergeWith.js';
import { getConfigWithMeta } from './config.js';
import {
  Context,
  Rules,
  type TreeContext,
  type ContextOptions,
  type PrintOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  type TriviaMap,
  type Trivia,
  JessError,
  toDiagnostic,
  evalErrorFrameFrom,
  WARN,
  logger,
  Deprecation,
  type Visitor,
  type WarningsConfigInput,
  type ErrorsConfigInput,
  createRenderBuffer,
  finalizeFlatRenderBuffer
} from '@jesscss/core';
import {
  getOptions,
  applyStrictPreset,
  type StylesConfig,
  type OutputOptions
} from 'styles-config';
import type { PluginInterface } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import scssPlugin from '@jesscss/plugin-scss';
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
  /** Warning-display config (scalar tier or object). Default tier: `line`. */
  warnings?: WarningsConfigInput;
  /** Error-display config (scalar tier or object). Default tier: `frame`. */
  errors?: ErrorsConfigInput;
};

const { isArray } = Array;

function isVisitor(value: unknown): value is Visitor {
  return typeof value === 'object' && value !== null;
}

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

type CommentRange = readonly [number, number];

/**
 * A view over a TriviaMap that hides comment runs. The dialect decides how much:
 *
 * - `liftedRanges === undefined` — the parser doesn't report which comments it
 *   lifted to `Comment` nodes, so hide EVERY comment run (whitespace-only view).
 *   The historical, conservative behavior; used where inline-comment placement
 *   isn't wired end-to-end.
 * - `liftedRanges` provided — hide ONLY the runs already lifted to standalone
 *   `Comment` nodes (re-emitting those would double-print). INLINE comments (in
 *   selectors, values, function args, at-rule preludes) are never lifted — they
 *   only survive via trivia — so their runs pass through for the serializers to
 *   place. A run is "lifted" when a lifted range overlaps it; the whole run is
 *   then hidden (the container serializer re-inserts inter-statement spacing).
 *
 * Pure-whitespace runs always pass (authored value/list spacing).
 */
function commentAwareTrivia(trivia: TriviaMap, liftedRanges: readonly CommentRange[] | undefined): TriviaMap {
  const isHidden = (run: { start: number; end: number; hasComment: boolean }): boolean => {
    if (!run.hasComment) {
      return false;
    }
    if (liftedRanges === undefined) {
      return true;
    }
    for (const [start, end] of liftedRanges) {
      if (start < run.end && end > run.start) {
        return true;
      }
    }
    return false;
  };
  let visibleComments: readonly Trivia[] | undefined;
  return {
    lookup(offset, direction) {
      const run = trivia.lookup(offset, direction);
      return run && !isHidden(run) ? run : undefined;
    },
    * entries(direction) {
      for (const entry of trivia.entries(direction)) {
        if (!isHidden(entry[1])) {
          yield entry;
        }
      }
    },
    has(offset, direction) {
      const run = trivia.lookup(offset, direction);
      return run !== undefined && !isHidden(run);
    },
    commentRuns() {
      if (visibleComments === undefined) {
        // Inner index is already sorted/deduped; drop hidden (lifted) runs so
        // they don't double-print, preserving the filtered view's semantics.
        visibleComments = trivia.commentRuns().filter(run => !isHidden(run));
      }
      return visibleComments;
    }
  };
}

/**
 * A parser plugin builds its own file-bearing TreeContext and records authored
 * whitespace/comment trivia on it (`node._treeContext.opts.trivia`). Rendering,
 * however, drives the shared render `context`, and the serializer seeds its
 * trivia from `context.opts.trivia`. Bridge the two so authored value whitespace
 * (multi-line lists, custom-property value spacing) survives to output. The root
 * file wins; imports keep their own per-node context for anything context-scoped.
 */
function adoptSourceTrivia(context: Context, node: { _treeContext?: TreeContext } | null): void {
  if (!node || 'trivia' in context.opts) {
    return;
  }
  const trivia = node._treeContext?.opts?.trivia;
  if (trivia) {
    // `liftedCommentRanges` present → expose inline comments, hide the lifted
    // standalone ones (Less). Absent → hide every comment run (whitespace-only),
    // the conservative default for dialects that don't report lifts yet.
    const liftedRanges = node._treeContext?.opts?.liftedCommentRanges as readonly CommentRange[] | undefined;
    context.opts.trivia = commentAwareTrivia(trivia as TriviaMap, liftedRanges);
  }
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
          importLessPlugin?: (absoluteFilePath: string) => Promise<unknown>;
        };
        if (!plugin.importLessPlugin) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable Less @plugin script execution.');
        }
        return plugin.importLessPlugin(absoluteFilePath);
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
    };
    this.jsPluginProxyCache.set(factoryRecord.key, proxy);
    return proxy;
  }

  private buildPlugins(resolved: ResolvedRenderConfig): PluginInterface[] {
    const pluginMap = new Map<string, PluginInterface>();
    const coreLessPlugin = this.getOrCreateLessPlugin(resolved.lessOptions);
    pluginMap.set(coreLessPlugin.name, coreLessPlugin);
    const coreScssPlugin = this.getOrCreateScssPlugin();
    pluginMap.set(coreScssPlugin.name, coreScssPlugin);
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

  private async visitBeforeEvalNode(node: any, visitor: any): Promise<any> {
    let result = node;

    if ((node.type === 'AtRule' || node.type === 'AtRuleStatement' || node.type === 'Directive') && typeof visitor.atRule === 'function') {
      const atRuleResult = await visitor.atRule(node, undefined);
      if (atRuleResult && typeof atRuleResult !== 'symbol') {
        result = atRuleResult;
      }
    }

    if (typeof visitor.visit === 'function') {
      const visitResult = await visitor.visit(result);
      if (visitResult && typeof visitResult !== 'symbol') {
        result = visitResult;
      }
    } else {
      const maybeAbort = visitor.enter?.(result);
      if (typeof maybeAbort === 'symbol') {
        return result;
      }
      const methodName = result.type.charAt(0).toLowerCase() + result.type.slice(1);
      const typeMethod = visitor[methodName];
      if (typeof typeMethod === 'function') {
        const typeResult = await typeMethod.call(visitor, result);
        if (typeResult && typeof typeResult !== 'symbol') {
          result = typeResult;
        }
      }
      const exitResult = await visitor.exit?.(result);
      if (exitResult && typeof exitResult !== 'symbol') {
        result = exitResult;
      }
    }

    // Iterate shallow semantic children (via childKeys). `walk(false)` yields the
    // immediate child nodes; this method recurses to descend. Core renamed the old
    // `children()` iterator to `walk()` (`.children` is now the Parséman structural
    // array), so use `walk` here.
    if (typeof result.walk === 'function') {
      for (const child of result.walk(false)) {
        await this.visitBeforeEvalNode(child, visitor);
      }
    }
    return result;
  }

  private async applyBeforeEvalVisitors(context: Context, tree: Rules, currentFilePath: string): Promise<Rules> {
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
        const pre = plugin.beforeEvalVisitorForTree
          ? plugin.beforeEvalVisitorForTree(current, currentFilePath)
          : plugin.beforeEvalVisitor;
        if (!pre) {
          continue;
        }
        const visitors = Array.isArray(pre) ? pre : [pre];
        for (const visitor of visitors) {
          if (!isVisitor(visitor)) {
            continue;
          }
          if (pass === 1 && processed.has(visitor)) {
            continue;
          }
          const result = await this.visitBeforeEvalNode(current, visitor);
          if (result instanceof Rules) {
            current = result;
          }
          processed.add(visitor);
        }
      }
    }
    return current;
  }

  /**
   * True iff some registered plugin exposes a real pre-render visitor
   * (`preRenderVisitor`/`postEvalVisitor` that passes `isVisitor`). Mirrors the
   * per-plugin hook selection in `applyPreRenderVisitors` EXACTLY, so the
   * `preSerializeRoot` hook is set precisely when that method would do work and
   * left unset (freeing a spine-eligible root to the single pass, §4.0/§6.9)
   * when it would be a no-op. Contract: pure predicate over `context.plugins`;
   * no eval, no tree mutation.
   */
  private hasPreRenderVisitor(context: Context): boolean {
    if (!context.plugins?.length) {
      return false;
    }
    for (const plugin of context.plugins) {
      const hooks = [
        plugin.preRenderVisitor,
        plugin.postEvalVisitor
      ].filter((hook): hook is NonNullable<typeof hook> => Boolean(hook));
      const visitors = hooks.flatMap(hook => Array.isArray(hook) ? hook : [hook]);
      if (visitors.some(visitor => isVisitor(visitor))) {
        return true;
      }
    }
    return false;
  }

  private applyPreRenderVisitors(context: Context, tree: Rules): Rules {
    if (!tree || !context.plugins?.length) {
      return tree;
    }
    let current = tree;
    for (const plugin of context.plugins) {
      const hooks = [
        plugin.preRenderVisitor,
        plugin.postEvalVisitor
      ].filter((hook): hook is NonNullable<typeof hook> => Boolean(hook));
      if (hooks.length === 0) {
        continue;
      }
      const visitors = hooks.flatMap(hook => Array.isArray(hook) ? hook : [hook]);
      for (const visitor of visitors) {
        if (!isVisitor(visitor)) {
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
      const processedTree = await this.applyBeforeEvalVisitors(context, result.node, resolvedPath);
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

  /**
   * Parse + before-eval transforms + `context.root` — everything the tree needs
   * BEFORE evaluation. The eval itself is driven separately: `compile()` evals
   * here via `evaluateInput`; the render path defers eval into `render()` (D3 —
   * `render()` is the sole eval driver for serialization).
   */
  private async prepareInputTree(
    context: Context,
    resolved: ResolvedRenderConfig,
    input: { filePath?: string; source?: string; language?: string; extension?: string },
    profile?: RenderProfile
  ): Promise<Rules> {
    const { filePath, source, language, extension } = input;
    const rootLessSourceOptions: RootLessSourceOptions = {
      banner: typeof resolved.activeOptions.banner === 'string'
        ? resolved.activeOptions.banner
        : undefined,
      globalVars: getLessVariableOverrides(resolved.activeOptions.globalVars),
      modifyVars: getLessVariableOverrides(resolved.activeOptions.modifyVars)
    };
    const shouldPrepareRootLessSource = hasRootLessSourceOptions(rootLessSourceOptions);

    if (filePath) {
      this.attachImportVisitorHook(context, filePath);
    }

    await measureProfileAsync(profile, 'prewarmPlugins', () => this.prewarmPlugins(context));

    let tree;
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
      const parsedNode = parsed.node;
      if (!parsedNode) {
        throw new Error(`Failed to parse ${filePath ?? '<input>'}`);
      }
      adoptSourceTrivia(context, parsedNode);
      tree = await measureProfileAsync(profile, 'applyBeforeEvalVisitors', () =>
        this.applyBeforeEvalVisitors(context, parsedNode, filePath ?? '<input>')
      );
      if (!context.root) {
        context.root = tree;
      }
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
      const loadedNode = loaded.node;
      if (!loadedNode) {
        throw new Error(`Failed to load ${filePath!}`);
      }
      adoptSourceTrivia(context, loadedNode);
      tree = await measureProfileAsync(profile, 'applyBeforeEvalVisitors', () =>
        this.applyBeforeEvalVisitors(context, loadedNode, filePath!)
      );
      if (!context.root) {
        context.root = tree;
      }
    }

    return tree;
  }

  /**
   * Prepare + eval + pre-render visitors, returning the EVALUATED tree. Used by
   * `compile()`, which returns an evaluated tree without serializing it. The
   * render path does NOT use this — it drives eval through `render()` (D3).
   */
  private async evaluateInput(
    context: Context,
    resolved: ResolvedRenderConfig,
    input: { filePath?: string; source?: string; language?: string; extension?: string },
    profile?: RenderProfile
  ): Promise<Rules> {
    const tree = await this.prepareInputTree(context, resolved, input, profile);
    const evald = await measureProfileAsync(profile, 'eval', async () => tree.eval(context));
    return measureProfileSync(profile, 'applyPreRenderVisitors', () =>
      this.applyPreRenderVisitors(context, evald)
    );
  }

  private async renderTree(tree: Rules, context: Context, profile?: RenderProfile): Promise<string> {
    // P2 gate refinement (§4.0 extend-work gate / §6.9 gated pre-eval): the
    // single-pass spine (`renderRootViaSpine`) engages only when
    // `preSerializeRoot` is UNSET (`rules.ts` spine gate). `preSerializeRoot`'s
    // sole job is to run `applyPreRenderVisitors` — a NO-OP unless some plugin
    // registers a `preRenderVisitor`/`postEvalVisitor`. Setting it
    // unconditionally kept every spine-eligible root pinned to the eval path
    // (the P1 finding: 0% of real renders routed through the live spine).
    //
    // We now set the hook ONLY when a real pre-render visitor exists. When none
    // does, the hook is genuinely absent, so a spine-eligible extend-free
    // root routes through the live single pass in production. Roots that need
    // extend or visitor work are still fully covered: extend-bearing / import-
    // bearing roots are not spine-eligible (`isSpineEligibleRoot` rejects
    // `:extend` selectors and top-level `@import` at-rules), and a registered
    // visitor re-arms `preSerializeRoot`, forcing the eval path. No dual dormant
    // path — this is the wire-in, not a parallel spine.
    const hasPreRenderVisitor = this.hasPreRenderVisitor(context);
    const printOptions: PrintOptions = {
      collapseNesting: context.opts.output?.collapseNesting,
      context,
      // D3: `render()` is the sole eval driver. `tree` enters unevaluated; render
      // evaluates it, then fires this hook on the evaluated root so post-eval /
      // pre-render plugin visitors transform it before serialization — the role
      // the removed separate `tree.eval()` pre-pass used to serve. Set only when
      // a real visitor is registered (see gate note above).
      preSerializeRoot: hasPreRenderVisitor
        ? evaluatedRoot =>
          measureProfileSync(profile, 'applyPreRenderVisitors', () =>
            this.applyPreRenderVisitors(context, evaluatedRoot)
          )
        : undefined
    };

    let css = await measureProfileAsync(profile, 'render', async () => {
      const buffer = createRenderBuffer('flat');
      buffer.shareWriter = true;
      await tree.render(context, buffer, printOptions);
      return finalizeFlatRenderBuffer(buffer);
    });
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

  /** @internal */
  async compile(filePath: string, options?: Partial<ConfigOptions>) {
    const { resolved, context, profile } = await this.prepareRender(filePath, options);

    try {
      const postEvald = await this.evaluateInput(context, resolved, { filePath }, profile);

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
      return { tree: postEvald, context };
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
      const tree = await this.prepareInputTree(context, resolved, { filePath }, profile);
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
    const { resolved, context, profile } = await this.prepareRender(filePath, renderOptions, { language, extension });

    try {
      const tree = await this.prepareInputTree(context, resolved, { filePath, source: content, language, extension }, profile);
      const css = await this.renderTree(tree, context, profile);
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
      const tree = await this.prepareInputTree(context, resolved, {
        filePath,
        source,
        language,
        extension
      }, profile);
      const css = await this.renderTree(tree, context, profile);

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
    tree: Rules | null;
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
      const evald = await this.evaluateInput(context, resolved, { filePath }, profile);

      context.finalizeWarnings();

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
      return { tree: null, context, errors, warnings };
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
      const tree = await this.evaluateInput(context, resolved, { filePath }, profile);
      const css = await this.renderTree(tree, context, profile);

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
    this.scssPluginInstance = undefined;
    this.configuredPluginFactoryCache.clear();
  }
}
