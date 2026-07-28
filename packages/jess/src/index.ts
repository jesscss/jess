import {
  Compiler as BaseCompiler,
  type CompilerPluginContext,
  type ConfigOptions
} from '@jesscss/compiler';
import type { PluginInterface } from '@jesscss/core';
import jessPlugin from '@jesscss/plugin-jess';
import lessPlugin from '@jesscss/plugin-less';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';
import scssPlugin from '@jesscss/plugin-scss';

export type { ConfigOptions } from '@jesscss/compiler';

type LessPluginInput = NonNullable<Parameters<typeof lessPlugin>[0]> & { plugins?: readonly unknown[] };
type LessPluginCacheKey = string;

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

function prepareRootSource(source: string, context: CompilerPluginContext): string {
  if (context.language !== undefined && context.language !== 'less') {
    return source;
  }
  const prefix = [
    typeof context.activeOptions.banner === 'string' ? context.activeOptions.banner : undefined,
    renderVariableOverrides(getVariableOverrides(context.activeOptions.globalVars))
  ].filter(Boolean).join('\n');
  const suffix = renderVariableOverrides(getVariableOverrides(context.activeOptions.modifyVars));

  return [
    prefix,
    source,
    suffix
  ].filter(Boolean).join('\n');
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
 * Batteries-included Jess compiler. The reusable render engine lives in
 * `@jesscss/compiler`; this package only chooses Jess's default plugin stack
 * and CLI-oriented dialect behavior.
 */
export class Compiler extends BaseCompiler {
  /** @internal */
  declare public opts: ConfigOptions;

  private lessPluginInstanceCache = new Map<LessPluginCacheKey, PluginInterface>();

  /*
   * Native Less plugin hooks are consumer objects. Their identity and order
   * affect registered functions, so they are part of the Less adapter cache key.
   */
  private nativeLessPluginIds = new Map<unknown, number>();
  private nextNativeLessPluginId = 0;
  private jessPluginInstance: PluginInterface | undefined;
  private scssPluginInstance: PluginInterface | undefined;

  constructor(opts: ConfigOptions = {
    compile: {},
    output: {},
    language: {}
  }) {
    super(opts, {
      defaultPlugins: context => this.defaultPlugins(context),
      normalizeConfiguredPlugin: (plugin, context) => this.normalizeConfiguredPlugin(plugin, context),
      prepareSource: prepareRootSource,
      scriptPluginSpecifier: '@jesscss/plugin-js',
      scriptPluginResolveFrom: import.meta.url
    });
  }

  private getLessPluginCacheKey(
    lessOptions: Record<string, unknown>,
    nativePlugins: readonly unknown[] = []
  ): LessPluginCacheKey {
    const optionsKey = stableStringify({
      math: lessOptions.math,
      mathMode: lessOptions.mathMode,
      strictUnits: lessOptions.strictUnits,
      unitMode: lessOptions.unitMode,
      equalityMode: lessOptions.equalityMode,
      allowExtendSelectors: lessOptions.allowExtendSelectors,
      leakyScope: lessOptions.leakyScope,
      bubbleRootAtRules: lessOptions.bubbleRootAtRules,
      collapseNesting: lessOptions.collapseNesting,
      rootpath: lessOptions.rootpath,
      rewriteUrls: lessOptions.rewriteUrls,
      urlArgs: lessOptions.urlArgs,
      processImports: lessOptions.processImports
    });
    if (nativePlugins.length === 0) {
      return optionsKey;
    }
    const nativePluginKey = nativePlugins.map((plugin) => {
      let id = this.nativeLessPluginIds.get(plugin);
      if (id === undefined) {
        id = ++this.nextNativeLessPluginId;
        this.nativeLessPluginIds.set(plugin, id);
      }
      return id;
    });
    return `${optionsKey}|native-plugins:${nativePluginKey.join(',')}`;
  }

  private getOrCreateLessPlugin(
    lessOptions: Record<string, unknown>,
    nativePlugins: readonly unknown[] = []
  ): PluginInterface {
    const key = this.getLessPluginCacheKey(lessOptions, nativePlugins);
    let plugin = this.lessPluginInstanceCache.get(key);
    if (!plugin) {
      const pluginOptions: LessPluginInput = {
        ...lessOptions,
        ...(nativePlugins.length === 0 ? {} : { plugins: nativePlugins })
      };
      plugin = lessPlugin(pluginOptions);
      this.lessPluginInstanceCache.set(key, plugin);
    }
    return plugin;
  }

  private getOrCreateJessPlugin(): PluginInterface {
    if (!this.jessPluginInstance) {
      this.jessPluginInstance = jessPlugin();
    }
    return this.jessPluginInstance;
  }

  private getOrCreateScssPlugin(): PluginInterface {
    if (!this.scssPluginInstance) {
      this.scssPluginInstance = scssPlugin();
    }
    return this.scssPluginInstance;
  }

  private defaultPlugins(context: CompilerPluginContext): readonly PluginInterface[] {
    return [
      nodeModulesPlugin({ basePath: context.resolutionBaseDir }),
      this.getOrCreateJessPlugin(),
      this.getOrCreateLessPlugin(context.optionsFor('less')),
      this.getOrCreateScssPlugin()
    ];
  }

  private normalizeConfiguredPlugin(
    plugin: PluginInterface,
    context: CompilerPluginContext
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
    return this.getOrCreateLessPlugin({
      ...pluginOptions,
      ...resolvedLessOptions
    }, nativePlugins);
  }

  override dispose(): void {
    super.dispose();
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
    this.lessPluginInstanceCache.clear();
    this.nativeLessPluginIds.clear();
    this.nextNativeLessPluginId = 0;
    this.jessPluginInstance = undefined;
    this.scssPluginInstance = undefined;
  }
}
