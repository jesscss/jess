import {
  type Plugin,
  AbstractPlugin,
  Context,
  type UrlTransformRequest,
  ERR,
  EXTERNAL_IMPORT_SPECIFIER,
  type ISafeParseResult,
  type PluginInterface,
  type SafeParseOptions,
  type SourceOptions,
  type SourceSettings,
  buildEvaluator,
  MATH_MODES,
  MODULE_MODES,
  ProvidedModules,
  UNIT_MODES,
  logger, type PluginHost, type ValueEvaluator } from '@jesscss/core';
import { makeLessRegistry } from '@jesscss/fns/less/registry';
import { LessApiBridge, type NativeLessPlugin } from '@jesscss/plugin-less-compat';
import type { MathMode, ModuleMode, UnitMode, LessOptions } from 'styles-config';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expandLessImportCandidates } from '@jesscss/style-resolver';
import { safeParse as safeParseLess } from '@jesscss/less-parser';

export type LessPluginOptions = LessOptions;
type LessDialectDefaults = Required<Pick<
  NonNullable<ISafeParseResult['dialectDefaults']>,
  'mathMode' | 'unitMode' | 'allowLeakyScope' | 'allowCallerScope' | 'bubbleRootAtRules' | 'processImports'
>>;

/**
 * The Less plugin's default option values — the single source of truth for the
 * v5 defaults. The `LessPlugin` constructor fills any unset option from here,
 * and the `lessc` CLI imports the same object so its defaults can never drift
 * from the engine's. Note `collapseNesting: false` — v5 preserves nesting by
 * default (Less 4.x flattened; that is now an explicit opt-in).
 */
export const lessPluginDefaults = {
  mathMode: 'parens-division' as MathMode,
  unitMode: 'preserve' as UnitMode,
  allowLeakyScope: true,
  allowCallerScope: false,
  bubbleRootAtRules: true,
  processImports: true,
  collapseNesting: false,
  moduleMode: 'auto' as ModuleMode
} as const;

const lessValueEvaluator = buildEvaluator(makeLessRegistry());

/**
 * The documented values of each mode option. Any other value is rejected: read
 * as some other mode, a typo would silently change the output.
 */
const MODE_OPTION_VALUES = {
  mathMode: MATH_MODES,
  math: [0, 1, 2, 3, ...MATH_MODES, 'strict-legacy'],
  unitMode: UNIT_MODES,
  moduleMode: MODULE_MODES
} as const;

function formatOptionValue(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : String(value);
}

/**
 * Reject a mode option outside its documented set. With a resolver context, a
 * value the styles.config file sets is reported against that file; a value
 * passed in code has no file to name.
 */
function checkModeOptions(
  opts: object,
  context?: Pick<LessPluginResolverContext, 'configFilePath' | 'configFileOptionsFor'>
): void {
  for (const [option, values] of Object.entries(MODE_OPTION_VALUES)) {
    const allowed: readonly unknown[] = values;
    const value: unknown = Reflect.get(opts, option);
    if (value === undefined || allowed.includes(value)) {
      continue;
    }
    const listed = allowed.map(formatOptionValue);
    const configFilePath = context?.configFilePath;
    throw ERR.pluginInvalidOption({
      filePath: configFilePath !== undefined && context?.configFileOptionsFor?.('less')[option] === value
        ? configFilePath
        : undefined,
      meta: {
        plugin: 'less',
        option,
        value: typeof value === 'string' ? `'${value}'` : JSON.stringify(value) ?? String(value),
        allowed: `${listed.slice(0, -1).join(', ')} or ${listed.at(-1)}`
      }
    });
  }
}

/**
 * `#less` is this plugin's private path to the Less built-in module
 * `@jesscss/fns/less`, resolved from THIS package's location so it works
 * whatever the importing project installs. The plugin loads and trusts it (no
 * script runtime); the package spelling reaching the same file is the same module.
 */
const providedModules = new ProvidedModules([['#less', '@jesscss/fns/less']], createRequire(import.meta.url));
type LessPluginInput = LessPluginOptions & { plugins?: readonly unknown[] };
type LessPluginCacheKey = string;

export type LessSourcePreparationContext = {
  language?: string;
  activeOptions: Record<string, unknown>;
};

export type LessPluginResolverContext = {
  optionsFor(language?: string): Record<string, unknown>;
  configFilePath?: string;
  configFileOptionsFor?(language?: string): Record<string, unknown>;
};

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

function normalizeVariableName(name: string): string {
  return name.startsWith('@') ? name : `@${name}`;
}

function renderVariableOverrides(vars: Record<string, unknown> | null | undefined): string {
  if (!vars) {
    return '';
  }
  return Object.entries(vars)
    .map(([name, value]) => `${normalizeVariableName(name)}: ${String(value)};`)
    .join('\n');
}

function getVariableOverrides(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null;
}

function cloneConfiguredPlugin(plugin: PluginInterface): PluginInterface {
  if (plugin.name !== 'less-compat' || typeof plugin.constructor !== 'function') {
    return plugin;
  }
  try {
    const opts = isObjectRecord(plugin) ? plugin.opts : undefined;
    const freshPlugin: unknown = Reflect.construct(plugin.constructor, [opts]);
    return isPluginInterface(freshPlugin) ? freshPlugin : plugin;
  } catch {
    return plugin;
  }
}

/**
 * Prepend `banner`/`globalVars` and append `modifyVars` to a Less entry source.
 * `sourceOffset` is the length of the prepended text, so source maps can point
 * into the file as authored.
 */
export function prepareLessRootSource(
  source: string,
  context: LessSourcePreparationContext
): { source: string; sourceOffset: number } {
  if (context.language !== undefined && context.language !== 'less') {
    return { source, sourceOffset: 0 };
  }
  const prefix = [
    typeof context.activeOptions.banner === 'string' ? context.activeOptions.banner : undefined,
    renderVariableOverrides(getVariableOverrides(context.activeOptions.globalVars))
  ].filter(Boolean).join('\n');
  const suffix = renderVariableOverrides(getVariableOverrides(context.activeOptions.modifyVars));

  return {
    source: [
      prefix,
      source,
      suffix
    ].filter(Boolean).join('\n'),
    sourceOffset: prefix === '' ? 0 : prefix.length + 1
  };
}

export class LessPluginResolver {
  private pluginInstanceCache = new Map<LessPluginCacheKey, PluginInterface>();

  /*
   * Native Less plugin hooks are consumer objects. Their identity and order
   * affect registered functions, so they are part of the Less adapter cache key.
   */
  private nativePluginIds = new Map<unknown, number>();
  private nextNativePluginId = 0;

  private getCacheKey(
    lessOptions: Record<string, unknown>,
    nativePlugins: readonly unknown[] = []
  ): LessPluginCacheKey {
    const optionsKey = stableStringify({
      math: lessOptions.math,
      mathMode: lessOptions.mathMode,
      strictMath: lessOptions.strictMath,
      strictUnits: lessOptions.strictUnits,
      unitMode: lessOptions.unitMode,
      moduleMode: lessOptions.moduleMode,
      allowExtendSelectors: lessOptions.allowExtendSelectors,
      allowLeakyScope: lessOptions.allowLeakyScope,
      leakyScope: lessOptions.leakyScope,
      allowCallerScope: lessOptions.allowCallerScope,
      bubbleRootAtRules: lessOptions.bubbleRootAtRules,
      collapseNesting: lessOptions.collapseNesting,
      rootpath: lessOptions.rootpath,
      rewriteUrls: lessOptions.rewriteUrls,
      relativeUrls: lessOptions.relativeUrls,
      urlArgs: lessOptions.urlArgs,
      processImports: lessOptions.processImports
    });
    if (nativePlugins.length === 0) {
      return optionsKey;
    }
    const nativePluginKey = nativePlugins.map((plugin) => {
      let id = this.nativePluginIds.get(plugin);
      if (id === undefined) {
        id = ++this.nextNativePluginId;
        this.nativePluginIds.set(plugin, id);
      }
      return id;
    });
    return `${optionsKey}|native-plugins:${nativePluginKey.join(',')}`;
  }

  /**
   * The Less plugin for these options. `context`, when the options were
   * resolved for a render, lets an invalid value name the config file it came from.
   * `ownOptions` are the options the user built the plugin with, which the
   * settings scoped to each source override ({@link LessPlugin}).
   */
  getOrCreate(
    lessOptions: Record<string, unknown>,
    nativePlugins: readonly unknown[] = [],
    context?: LessPluginResolverContext,
    ownOptions: Record<string, unknown> = {}
  ): PluginInterface {
    const ownKey = this.getCacheKey(ownOptions);
    const key = `${this.getCacheKey(lessOptions, nativePlugins)}|own:${ownKey}`;
    let plugin = this.pluginInstanceCache.get(key);
    if (!plugin) {
      checkModeOptions(lessOptions, context);
      const pluginOptions: LessPluginInput = {
        ...lessOptions,
        ...(nativePlugins.length === 0 ? {} : { plugins: nativePlugins })
      };
      const own: LessPluginOptions = { ...ownOptions };
      plugin = new LessPlugin(pluginOptions, own);
      this.pluginInstanceCache.set(key, plugin);
    }
    return plugin;
  }

  normalizeConfiguredPlugin(
    plugin: PluginInterface,
    context: LessPluginResolverContext
  ): PluginInterface {
    if (plugin.name !== 'less') {
      return cloneConfiguredPlugin(plugin);
    }
    const pluginOptions = isObjectRecord(plugin) && isObjectRecord(plugin.opts)
      ? plugin.opts
      : {};
    const resolvedLessOptions = Object.fromEntries(
      Object.entries(context.optionsFor('less')).filter(([, value]) => value !== undefined)
    );
    const nativePlugins = Array.isArray(pluginOptions.plugins) ? pluginOptions.plugins : [];
    return this.getOrCreate({
      ...pluginOptions,
      ...resolvedLessOptions
    }, nativePlugins, context, pluginOptions);
  }

  dispose(): void {
    for (const plugin of this.pluginInstanceCache.values()) {
      try {
        void plugin.dispose?.();
      } catch {
        // ignore cleanup failures
      }
    }
    this.pluginInstanceCache.clear();
    this.nativePluginIds.clear();
    this.nextNativePluginId = 0;
  }
}

/** Match Less's URL normalization without treating URL text as an import path. */
function normalizeUrlPath(url: string): string {
  const segments = url.split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (normalized.length === 0 || normalized[normalized.length - 1] === '..') {
        normalized.push(segment);
      } else {
        normalized.pop();
      }
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join('/');
}

function isUrlRelative(url: string): boolean {
  if (url.startsWith('/') || url.startsWith('#')) {
    return false;
  }
  const colon = url.indexOf(':');
  if (colon < 0) {
    return true;
  }
  for (let index = 0; index < colon; index++) {
    const code = url.charCodeAt(index);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!isLetter && url[index] !== '-') {
      return true;
    }
  }
  return false;
}

function rewriteUrlPath(url: string, rootpath: string): string {
  const rewritten = normalizeUrlPath(rootpath + url);
  return url.startsWith('.') && isUrlRelative(rootpath) && !rewritten.startsWith('.')
    ? `./${rewritten}`
    : rewritten;
}

/**
 * A relative URL in a fetched document names a resource beside that document,
 * so rewriting rebases it onto the document's URL — the remote counterpart of
 * prefixing a local import's directory. The result is absolute, so `rootpath`
 * has nothing to prefix. Only the leading `./`/`../` segments are resolved as a
 * URL (clamped at the host's root); the rest keeps its authored text, escapes
 * included.
 */
function rebaseOntoDocumentUrl(url: string, documentUrl: string, quoted: boolean): string {
  let rest = url;
  while (rest.startsWith('./') || rest.startsWith('../')) {
    rest = rest.slice(rest.indexOf('/') + 1);
  }
  const directory = new URL(url.slice(0, url.length - rest.length) || '.', documentUrl).href;
  return (quoted ? directory : escapeUnquotedUrlPath(directory)) + rest;
}

function escapeUnquotedUrlPath(pathValue: string): string {
  let escaped = '';
  for (const char of pathValue) {
    escaped += char === '(' || char === ')' || char === '\'' || char === '"' || ' \t\n\r\f'.includes(char)
      ? `\\${char}`
      : char;
  }
  return escaped;
}

/** A Less source's policy: the modes its settings name over the Less defaults. */
type LessPolicy = {
  readonly dialectDefaults: LessDialectDefaults;
  readonly moduleMode: ModuleMode;
};

/** The modes one tier of Less settings sets, by their canonical names. */
type LessModeSettings = Partial<LessDialectDefaults> & { moduleMode?: ModuleMode };

/** The Less settings that name a mode, deprecated spellings included. */
type LessModeInput = Pick<
  LessPluginOptions,
  'mathMode' | 'math' | 'strictMath' | 'unitMode' | 'strictUnits' | 'allowLeakyScope' | 'leakyScope'
  | 'allowCallerScope' | 'bubbleRootAtRules' | 'processImports' | 'moduleMode'
>;

/**
 * The modes `opts` sets, each deprecated spelling read as the mode it names
 * within this one tier of settings, so a spelling keeps the precedence of the
 * tier it is written in. `warn` reports each deprecated spelling.
 */
function lessModeSettings(opts: LessModeInput, warn: (message: string) => void): LessModeSettings {
  // Handle deprecated math option -> mathMode conversion
  let mathMode: MathMode | undefined;
  if (opts.mathMode !== undefined) {
    mathMode = opts.mathMode;
  } else if (opts.math !== undefined) {
    // Convert deprecated math option to mathMode
    if (opts.math === 0 || opts.math === 'always') {
      mathMode = 'always';
    } else if (opts.math === 1 || opts.math === 'parens-division') {
      mathMode = 'parens-division';
    } else if (opts.math === 2 || opts.math === 'parens' || opts.math === 'strict') {
      mathMode = 'parens';
    } else {
      // 3 or 'strict-legacy' -> 'parens' (deprecated, use 'strict' instead)
      mathMode = 'parens';
    }
  } else if (opts.strictMath !== undefined) {
    mathMode = opts.strictMath ? 'parens' : lessPluginDefaults.mathMode;

    /*
     * `strictMath` is the Less 4.x boolean alias of `math` (orchestrator judgment
     * under owner delegation, 2026-10-05), on the `strictUnits` pattern: `true`
     * is 'parens', `false` the default, and an explicit `mathMode` or `math`
     * wins. Any use warns.
     */
    warn(`strictMath is deprecated; use mathMode. strictMath: ${String(opts.strictMath)} now means mathMode: '${mathMode}'`);
  }

  /*
   * `strictUnits` is the deprecated boolean alias of `unitMode` (owner ruling
   * 2026-09-02): `true` → 'strict'; `false` means "not strict", i.e. the
   * default 'preserve' — NOT the Less 4.x 'loose' fold, which is only ever
   * selected by an explicit `unitMode: 'loose'`. Any use warns so the mapping
   * is never discovered by staring at output.
   */
  let unitMode = opts.unitMode;
  if (unitMode === undefined && opts.strictUnits !== undefined) {
    unitMode = opts.strictUnits ? 'strict' : lessPluginDefaults.unitMode;
    warn(
      `strictUnits is deprecated; use unitMode. strictUnits: ${String(opts.strictUnits)} now means `
      + `unitMode: '${unitMode}'${opts.strictUnits ? '' : ' (Less 4.x unit folding is unitMode: \'loose\')'}`
    );
  }
  return {
    mathMode,
    unitMode,
    allowLeakyScope: opts.allowLeakyScope ?? opts.leakyScope,
    allowCallerScope: opts.allowCallerScope,
    bubbleRootAtRules: opts.bubbleRootAtRules,
    processImports: opts.processImports,
    moduleMode: opts.moduleMode
  };
}

/** The policy `source`'s settings over `own` over the Less defaults ({@link LessPlugin}). */
function lessPolicy(own: LessModeSettings, source: LessModeSettings = {}): LessPolicy {
  return {
    dialectDefaults: Object.freeze({
      mathMode: source.mathMode ?? own.mathMode ?? lessPluginDefaults.mathMode,
      unitMode: source.unitMode ?? own.unitMode ?? lessPluginDefaults.unitMode,
      allowLeakyScope: source.allowLeakyScope ?? own.allowLeakyScope ?? lessPluginDefaults.allowLeakyScope,
      allowCallerScope: source.allowCallerScope ?? own.allowCallerScope ?? lessPluginDefaults.allowCallerScope,
      bubbleRootAtRules: source.bubbleRootAtRules ?? own.bubbleRootAtRules ?? lessPluginDefaults.bubbleRootAtRules,
      processImports: source.processImports ?? own.processImports ?? lessPluginDefaults.processImports
    }),
    moduleMode: source.moduleMode ?? own.moduleMode ?? lessPluginDefaults.moduleMode
  };
}

export class LessPlugin extends AbstractPlugin {
  name = 'less';
  supportedExtensions = ['.less'];
  readonly valueEvaluator: ValueEvaluator = lessValueEvaluator;
  readonly #policy: LessPolicy;

  /** The modes this plugin was built with, under the settings a host scopes to each source. */
  readonly #own: LessModeSettings;
  readonly #warned = new Set<string>();

  /** `rewriteUrls`, or what the deprecated `relativeUrls` names when it is unset. */
  readonly #rewriteUrls: LessPluginOptions['rewriteUrls'];
  private readonly pluginHosts = new WeakMap<Context, PluginHost>();

  /**
   * `own` is the options a user built the plugin with, when `opts` also carries
   * settings a host resolved for the entry ({@link LessPluginResolver}): under a
   * host that scopes settings to each source, those reach every file through
   * its own settings instead.
   */
  constructor(public opts: LessPluginOptions = {}, own: LessPluginOptions = opts) {
    super();
    checkModeOptions(opts);
    const warn = (message: string): void => this.#warn(message);
    this.#policy = lessPolicy(lessModeSettings(opts, warn));
    if (own !== opts) {
      checkModeOptions(own);
    }
    this.#own = lessModeSettings(own, warn);

    /*
     * `relativeUrls` is the Less 4.x boolean alias of `rewriteUrls` (orchestrator
     * judgment under owner delegation 2026-10-07), on the `strictMath` pattern:
     * `true` is 'all', `false` the default, and an explicit `rewriteUrls` wins.
     * Any use warns.
     */
    this.#rewriteUrls = opts.rewriteUrls;
    if (opts.rewriteUrls === undefined && opts.relativeUrls !== undefined) {
      this.#rewriteUrls = opts.relativeUrls ? 'all' : undefined;
      warn(`relativeUrls is deprecated; use rewriteUrls. relativeUrls: ${String(opts.relativeUrls)} now means rewriteUrls: '${opts.relativeUrls ? 'all' : 'off'}'`);
    }
  }

  /** Each deprecated spelling warns once, however many files are read with it. */
  #warn(message: string): void {
    if (!this.#warned.has(message)) {
      this.#warned.add(message);
      logger.warn(message);
    }
  }

  /**
   * The policy for one source (DESIGN-DECISIONS C19): the settings the host
   * scopes to that file over the options this plugin was built with. A value
   * its `styles.config` set wrong names that file.
   */
  #policyFor(settings: SourceOptions | undefined, configFile: SourceSettings['configFile']): LessPolicy {
    if (settings === undefined) {
      return this.#policy;
    }
    checkModeOptions(settings, configFile && {
      configFilePath: configFile.path,
      configFileOptionsFor: () => configFile.options
    });
    return lessPolicy(this.#own, lessModeSettings(settings, message => this.#warn(message)));
  }

  transformUrl({ value, quoted, kind, fromFilePath, entryFilePath }: UrlTransformRequest): string {
    let transformed: string;
    if (isUrlRelative(value)) {
      const rewriteUrls = this.#rewriteUrls;
      const local = value.startsWith('.');

      /*
       * `rootpath` applies to every relative URL by default, but the explicit
       * Less `local` mode narrows that to authored ./ and ../ paths.
       */
      if (rewriteUrls !== 'local' || local) {
        const rebasesImportedUrl = rewriteUrls === true || rewriteUrls === 'all' || (rewriteUrls === 'local' && local);
        if (rebasesImportedUrl && fromFilePath !== undefined && EXTERNAL_IMPORT_SPECIFIER.test(fromFilePath)) {
          transformed = rebaseOntoDocumentUrl(value, fromFilePath, quoted);
        } else {
          let rootpath = this.opts.rootpath ?? '';
          if (!quoted) {
            rootpath = escapeUnquotedUrlPath(rootpath);
          }
          if (rebasesImportedUrl && fromFilePath && entryFilePath) {
            const relativeDirectory = path.relative(path.dirname(entryFilePath), path.dirname(fromFilePath));
            if (relativeDirectory) {
              rootpath += `${relativeDirectory.split(path.sep).join('/')}/`;
            }
          }
          transformed = rewriteUrlPath(value, rootpath);
        }
      } else {
        transformed = normalizeUrlPath(value);
      }
    } else {
      transformed = normalizeUrlPath(value);
    }
    if (this.#addsUrlArgs(value, kind)) {
      const args = `${transformed.includes('?') ? '&' : '?'}${this.opts.urlArgs}`;
      const fragment = transformed.indexOf('#');
      transformed = fragment < 0
        ? transformed + args
        : transformed.slice(0, fragment) + args + transformed.slice(fragment);
    }
    return transformed;
  }

  /** `urlArgs`, when {@link transformUrl} would add it to an escaped `url()` body. */
  escapedUrlSkips({ value, kind }: UrlTransformRequest): string | undefined {
    return this.#addsUrlArgs(value, kind) ? 'urlArgs' : undefined;
  }

  /** Whether `urlArgs` goes on a `url()` target: never on an import path or a `data:` URI. */
  #addsUrlArgs(value: string, kind: UrlTransformRequest['kind']): boolean {
    return Boolean(this.opts.urlArgs) && kind !== 'import' && !value.trimStart().toLowerCase().startsWith('data:');
  }

  expandImport(importPath: string, currentDir: string) {
    void currentDir;

    // Keep import expansion in sync with the language service.
    return expandLessImportCandidates(importPath);
  }

  setContext(context: Context): void {
    if (context.documentContext?.plugin !== this) {
      return;
    }

    let host = this.pluginHosts.get(context);
    if (!host) {
      const configured = (this.opts as LessPluginOptions & { plugins?: NativeLessPlugin[] }).plugins ?? [];
      const bridge = new LessApiBridge(configured);
      host = bridge.createPluginHost({
        loadPluginModule: async ({ specifier, options }) => {
          /*
           * `@plugin` loads and executes a script module. When script modules
           * are disabled the load must REFUSE here: the ast/ evaluator reaches
           * `loadPlugin` directly (prepareBodyPlugins), so the import-path
           * check in Context is not on this route.
           */
          if (context.opts.disableScriptModules || context.opts.disablePluginRule) {
            throw ERR.pluginLoadFailed({
              meta: {
                specifier,
                reason: 'script module execution is disabled by disableScriptModules'
              },
              reason: `"@plugin \\"${specifier}\\"" loads and executes a script module, which this compile disabled.`,
              fix: 'Remove the @plugin statement, or stop setting disableScriptModules for this compile.'
            });
          }
          const loaded = await context.getPluginModule(specifier, options);
          return loaded.module;
        }
      });
      this.pluginHosts.set(context, host);
    }
    const existingHost = context.pluginHost;
    const globalFns = [
      ...(existingHost?.globalFns ?? []),
      ...(host.globalFns ?? [])
    ];
    context.pluginHost = {
      ...existingHost,
      ...host,
      ...(globalFns.length === 0 ? {} : { globalFns }),
      loadPlugin: host.loadPlugin || existingHost?.loadPlugin
        ? request => Promise.all([
          existingHost?.loadPlugin?.(request) ?? [],
          host.loadPlugin?.(request) ?? []
        ]).then(([existingFns, hostFns]) => [
          ...existingFns,
          ...hostFns
        ])
        : undefined,
      invokeRawFunction: (fn, args, ctx) =>
        host.invokeRawFunction?.(fn, args, ctx) ?? existingHost?.invokeRawFunction?.(fn, args, ctx)
    };
  }

  canImportModule(absoluteFilePath: string): boolean {
    return providedModules.owns(absoluteFilePath);
  }

  import(absoluteFilePath: string): Promise<Record<string, unknown>> {
    return providedModules.import(absoluteFilePath);
  }

  override resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    const mapped = paths.map((candidate) => {
      const provided = providedModules.resolve(candidate);
      if (provided !== null) {
        return provided;
      }
      if (candidate.startsWith('@less/test-import-module/')) {
        const after = candidate.slice('@less/test-import-module/'.length);
        const marker = `${path.sep}packages${path.sep}test-data${path.sep}`;
        const idx = currentDir.indexOf(marker);
        if (idx !== -1) {
          const packagesRoot = currentDir.slice(0, idx + `${path.sep}packages`.length);
          return path.join(packagesRoot, 'test-import-module', after);
        }
      }
      return candidate;
    });

    const resolved = super.resolve(mapped, currentDir, searchPaths);
    const out = [...resolved];
    const bases = [currentDir, ...searchPaths, process.cwd()];
    const looksBareSpecifier = (p: string) =>
      !path.isAbsolute(p)
      && !p.startsWith('./')
      && !p.startsWith('../')
      && !p.startsWith('/')
      && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p);

    for (const candidate of mapped) {
      if (!looksBareSpecifier(candidate)) {
        continue;
      }
      for (const base of bases) {
        const baseDir = path.isAbsolute(base) ? base : path.resolve(currentDir, base);
        try {
          const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
          const resolvedModule = req.resolve(candidate);
          if (!out.includes(resolvedModule)) {
            out.push(resolvedModule);
          }
          break;
        } catch {
          try {
            const req = createRequire(path.join(baseDir, '__jess_resolve__.js'));
            const resolvedModuleLess = req.resolve(`${candidate}.less`);
            if (!out.includes(resolvedModuleLess)) {
              out.push(resolvedModuleLess);
            }
            break;
          } catch {
            // keep trying other base dirs
          }
        }
      }
    }
    return out;
  }

  /**
   * `mathMode` reaches the GRAMMAR, not the evaluator (§12.6b): Less's `math:`
   * policy decides at parse whether each operation computes with no enclosing
   * math context, and the answer is written onto the node.
   *
   * The grammar receives the same precedence that Context installs after
   * parsing (`resolveOptions`): the settings the host supplies for the source,
   * else the compile's, over the Less defaults. It does not depend on
   * `documentContext`, which is populated only after the parse returns.
   *
   * `moduleMode` reaches the grammar for the same reason: whether the Less
   * built-ins are ambient is decided per document, where the grammar sees its
   * `@use`/`@compose` directives, and every call node carries the answer
   * (ledger P36).
   */
  safeParse(filePath: string, source: string, parseOptions?: SafeParseOptions): ISafeParseResult {
    const settings = parseOptions?.sourceOptions;
    const policy = this.#policyFor(settings, parseOptions?.sourceConfigFile);
    const result = safeParseLess(filePath, source, {
      mathMode: (settings === undefined ? parseOptions?.compilerOptions?.mathMode : undefined)
        ?? policy.dialectDefaults.mathMode,
      moduleMode: policy.moduleMode
    });
    if (result.document) {
      result.dialectDefaults = policy.dialectDefaults;
    }
    return result;
  }
}

export type { LessOptions } from 'styles-config';
const lessPlugin = ((opts?: LessPluginOptions) => {
  return new LessPlugin(opts);
}) satisfies Plugin;

export default lessPlugin;
