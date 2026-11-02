import {
  Compiler as BaseCompiler,
  type CompilerHooks,
  type CompilerPluginContext,
  type ConfigOptions
} from '@jesscss/compiler';
import { AbstractPlugin, type ISafeParseResult, type PluginInterface, type ProvidedModules } from '@jesscss/core';
import { LessPluginResolver, prepareLessRootSource } from '@jesscss/plugin-less';

/*
 * Plugin factories are imported by name, never as a default import: the
 * CommonJS build reads a default import of a package with Node's interop, which
 * hands back the package's whole `exports` object rather than its `default`.
 */
import { nodeModulesPlugin } from '@jesscss/plugin-node-modules';
import { providedModules as scssProvidedModules } from '@jesscss/plugin-scss/provided-modules';

export type { ConfigOptions } from '@jesscss/compiler';

export interface DefaultCompilerStack {
  readonly hooks: CompilerHooks;
  dispose(): void;
}

/** The `AbstractPlugin` path handling a deferred dialect plugin keeps until it loads. */
class DefaultPathPlugin extends AbstractPlugin {
  name = 'default-paths';
}

const defaultPaths = new DefaultPathPlugin();

/**
 * A dialect plugin whose package, and the grammar it loads, is imported only
 * when Context first parses a document of its dialect (`loadParser`), so a
 * compile loads no grammar it does not use.
 *
 * Until then it answers as `AbstractPlugin`, as the real plugin does for any
 * path that is not one of its provided modules. A plugin that provides modules
 * hands over its table (`provided`), which loads no grammar, so the provided
 * modules resolve, are claimed and are imported as the real plugin does, before
 * it loads.
 *
 * Once loaded, every member of the real plugin is copied onto this one, its
 * methods bound to the real plugin, for the rest of the compile that loaded
 * it; the stack hands later compiles the real plugin itself (`plugin`).
 */
class DeferredDialectPlugin implements PluginInterface {
  plugin: PluginInterface | undefined;
  #loading: Promise<void> | undefined;
  readonly canImportModule?: (absoluteFilePath: string) => boolean;
  readonly import?: (absoluteFilePath: string) => Promise<Record<string, unknown>>;
  readonly packageModule?: (specifier: string) => string | undefined;

  constructor(
    readonly name: string,
    readonly supportedExtensions: string[],
    private readonly create: () => Promise<PluginInterface>,
    private readonly provided?: ProvidedModules
  ) {
    if (provided) {
      this.canImportModule = absoluteFilePath => provided.owns(absoluteFilePath);
      this.import = absoluteFilePath => provided.import(absoluteFilePath);
      this.packageModule = specifier => provided.packageOf(specifier);
    }
  }

  loadParser(): Promise<void> | undefined {
    if (this.plugin) {
      return undefined;
    }
    return this.#loading ??= this.create().then((plugin) => {
      this.plugin = plugin;
      adoptMembers(this, plugin);
    });
  }

  safeParse(): ISafeParseResult {
    throw new Error(`The ${this.name} plugin parses only after Context awaits its loadParser()`);
  }

  resolve(paths: string | string[], currentDir: string, searchPaths: string[]): string[] {
    const provided = this.provided;
    const candidates = typeof paths === 'string' ? [paths] : paths;
    return defaultPaths.resolve(provided ? candidates.map(candidate => provided.resolve(candidate) ?? candidate) : candidates, currentDir, searchPaths);
  }

  locate(candidates: string[], currentDir: string): string | null {
    return defaultPaths.locate(candidates, currentDir);
  }

  getSource(absoluteFilePath: string): Promise<string> {
    return defaultPaths.getSource(absoluteFilePath);
  }
}

/** Copy every member of `plugin`, own and inherited, onto `target`, methods bound to `plugin`. */
function adoptMembers(target: object, plugin: PluginInterface): void {
  let source: unknown = plugin;
  while (typeof source === 'object' && source !== null && source !== Object.prototype) {
    for (const key of Reflect.ownKeys(source)) {
      if (key === 'constructor' || Object.prototype.hasOwnProperty.call(target, key)) {
        continue;
      }
      const value: unknown = Reflect.get(plugin, key);
      Object.defineProperty(target, key, {
        value: typeof value === 'function' ? value.bind(plugin) : value,
        writable: true,
        configurable: true,
        enumerable: true
      });
    }
    source = Object.getPrototypeOf(source);
  }
}

class DefaultCompilerStackImpl implements DefaultCompilerStack {
  private lessPluginResolver = new LessPluginResolver();
  private jessPluginInstance: DeferredDialectPlugin | undefined;
  private scssPluginInstance: DeferredDialectPlugin | undefined;
  private cssPluginInstance: DeferredDialectPlugin | undefined;

  readonly hooks: CompilerHooks;

  constructor(scriptPluginResolveFrom: string) {
    this.hooks = {
      defaultPlugins: context => this.defaultPlugins(context),
      normalizeConfiguredPlugin: (plugin, context) =>
        this.lessPluginResolver.normalizeConfiguredPlugin(plugin, context),
      prepareSource: prepareLessRootSource,
      scriptPluginSpecifier: '@jesscss/plugin-js',
      scriptPluginResolveFrom
    };
  }

  private getOrCreateJessPlugin(): PluginInterface {
    const deferred = this.jessPluginInstance ??= new DeferredDialectPlugin('jess', ['.jess'],
      async () => (await import('@jesscss/plugin-jess')).jessPlugin());
    return deferred.plugin ?? deferred;
  }

  private getOrCreateScssPlugin(): PluginInterface {
    const deferred = this.scssPluginInstance ??= new DeferredDialectPlugin('scss', ['.scss'],
      async () => (await import('@jesscss/plugin-scss')).scssPlugin(), scssProvidedModules);
    return deferred.plugin ?? deferred;
  }

  private getOrCreateCssPlugin(): PluginInterface {
    const deferred = this.cssPluginInstance ??= new DeferredDialectPlugin('css', ['.css'],
      async () => new (await import('./css.js')).CssPlugin());
    return deferred.plugin ?? deferred;
  }

  private defaultPlugins(context: CompilerPluginContext): readonly PluginInterface[] {
    return [
      nodeModulesPlugin({ basePath: context.resolutionBaseDir }),
      this.getOrCreateJessPlugin(),
      this.lessPluginResolver.getOrCreate(context.optionsFor('less'), [], context),
      this.getOrCreateScssPlugin(),
      this.getOrCreateCssPlugin()
    ];
  }

  dispose(): void {
    this.lessPluginResolver.dispose();
    try {
      void this.scssPluginInstance?.plugin?.dispose?.();
    } catch {
      // ignore cleanup failures
    }
    this.lessPluginResolver = new LessPluginResolver();
    this.jessPluginInstance = undefined;
    this.scssPluginInstance = undefined;
    this.cssPluginInstance = undefined;
  }
}

export function createDefaultCompilerStack(scriptPluginResolveFrom: string): DefaultCompilerStack {
  return new DefaultCompilerStackImpl(scriptPluginResolveFrom);
}

export class DefaultCompiler extends BaseCompiler {
  /** This class, so a render that runs in the script sandbox runs with the same compiler. */
  static override readonly moduleIdentity = { module: import.meta.url, exportName: 'DefaultCompiler' };

  private readonly defaultStack: DefaultCompilerStack;

  constructor(opts: ConfigOptions = { compile: {}, output: {}, language: {} }, scriptPluginResolveFrom = import.meta.url) {
    const defaultStack = createDefaultCompilerStack(scriptPluginResolveFrom);
    super(opts, defaultStack.hooks);
    this.defaultStack = defaultStack;
  }

  override dispose(): void {
    super.dispose();
    this.defaultStack.dispose();
  }
}
