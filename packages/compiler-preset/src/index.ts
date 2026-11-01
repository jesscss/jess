import {
  Compiler as BaseCompiler,
  type CompilerHooks,
  type CompilerPluginContext,
  type ConfigOptions
} from '@jesscss/compiler';
import { AbstractPlugin, type ISafeParseResult, type PluginInterface } from '@jesscss/core';
import { LessPluginResolver, prepareLessRootSource } from '@jesscss/plugin-less';

/*
 * Plugin factories are imported by name, never as a default import: the
 * CommonJS build reads a default import of a package with Node's interop, which
 * hands back the package's whole `exports` object rather than its `default`.
 */
import { nodeModulesPlugin } from '@jesscss/plugin-node-modules';

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
 * path that is not one of its provided modules. A plugin that `providesModules`
 * resolves its `#…` aliases and `@…` package spellings itself, and only a
 * candidate with a `#` or `@` can be one (`ProvidedModules.resolve`), so such a
 * candidate loads the plugin first.
 *
 * Once loaded, every member of the real plugin is copied onto this one, its
 * methods bound to the real plugin, for the rest of the compile that loaded
 * it; the stack hands later compiles the real plugin itself (`plugin`).
 *
 * ponytail: before it loads, it claims no module file (`canImportModule`), so a
 * provided module reached by a path with no `#` or `@` is untrusted until the
 * plugin loads. It fails closed. Tracked in jesscss/jess#518.
 */
class DeferredDialectPlugin implements PluginInterface {
  plugin: PluginInterface | undefined;
  #loading: Promise<void> | undefined;

  constructor(
    readonly name: string,
    readonly supportedExtensions: string[],
    private readonly providesModules: boolean,
    private readonly create: () => Promise<PluginInterface>
  ) {}

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

  resolve(paths: string | string[], currentDir: string, searchPaths: string[]): string[] | Promise<string[] | null> {
    if (this.providesModules && (typeof paths === 'string' ? [paths] : paths).some(candidate => /[#@]/.test(candidate))) {
      return Promise.resolve(this.loadParser()).then(() => {
        const plugin = this.plugin;
        return plugin?.resolve ? plugin.resolve(paths, currentDir, searchPaths) : defaultPaths.resolve(paths, currentDir, searchPaths);
      });
    }
    return defaultPaths.resolve(paths, currentDir, searchPaths);
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
    const deferred = this.jessPluginInstance ??= new DeferredDialectPlugin('jess', ['.jess'], false,
      async () => (await import('@jesscss/plugin-jess')).jessPlugin());
    return deferred.plugin ?? deferred;
  }

  private getOrCreateScssPlugin(): PluginInterface {
    const deferred = this.scssPluginInstance ??= new DeferredDialectPlugin('scss', ['.scss'], true,
      async () => (await import('@jesscss/plugin-scss')).scssPlugin());
    return deferred.plugin ?? deferred;
  }

  private getOrCreateCssPlugin(): PluginInterface {
    const deferred = this.cssPluginInstance ??= new DeferredDialectPlugin('css', ['.css'], false,
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
