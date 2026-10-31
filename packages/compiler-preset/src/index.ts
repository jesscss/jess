import {
  Compiler as BaseCompiler,
  type CompilerHooks,
  type CompilerPluginContext,
  type ConfigOptions
} from '@jesscss/compiler';
import { AbstractPlugin, type ISafeParseResult, parserDiagnostic, type PluginInterface } from '@jesscss/core';
import { parse as parseCss } from '@jesscss/css-parser';
import { LessPluginResolver, prepareLessRootSource } from '@jesscss/plugin-less';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';

export type { ConfigOptions } from '@jesscss/compiler';

/**
 * Plain `.css` input: parsed by the CSS grammar and rendered through the same
 * output options as every other dialect (`collapseNesting`, `compress`, source
 * maps). CSS has nothing to evaluate, so there is no value evaluator: values
 * are written as authored.
 */
export class CssPlugin extends AbstractPlugin {
  name = 'css';
  supportedExtensions = ['.css'];

  safeParse(filePath: string, source: string): ISafeParseResult {
    try {
      return { document: parseCss(source), errors: [], warnings: [] };
    } catch (error) {
      return { errors: [parserDiagnostic({ dialect: 'CSS', error, filePath, source })], warnings: [] };
    }
  }
}

export interface DefaultCompilerStack {
  readonly hooks: CompilerHooks;
  dispose(): void;
}

/**
 * A dialect plugin whose package, and the grammar it loads, is imported only
 * when Context first parses a document of its dialect (`loadParser`), so a
 * compile loads no grammar it does not use. Once loaded, every member is the
 * real plugin's.
 *
 * Until then it answers as `AbstractPlugin`, as the real plugin does for any
 * path that is not one of its provided modules. A plugin that `providesModules`
 * resolves its `#…` aliases and `@…` package spellings itself, and only a
 * candidate with a `#` or `@` can be one (`ProvidedModules.resolve`), so such a
 * candidate loads the plugin first.
 *
 * ponytail: before it loads, the plugin claims no module file
 * (`canImportModule`). A provided module reached by a path with no `#` or `@` (a
 * relative path into `@jesscss/fns`) is untrusted until a document of the
 * dialect, or one of its aliases, loads the plugin. Expose the plugin's module
 * table without its grammar if that path matters.
 */
function lazyDialectPlugin(
  name: string,
  supportedExtensions: string[],
  providesModules: boolean,
  create: () => Promise<PluginInterface>
): PluginInterface {
  let loaded: PluginInterface | undefined;
  let loading: Promise<PluginInterface> | undefined;
  const load = (): Promise<PluginInterface> => loading ??= create().then(plugin => (loaded = plugin));
  const defaults = new DefaultPathPlugin();
  const unloaded: PluginInterface = {
    name,
    supportedExtensions,
    loadParser: () => (loaded ? undefined : load().then(() => undefined)),
    safeParse: () => {
      throw new Error(`The ${name} plugin parses only after Context awaits its loadParser()`);
    },
    resolve: (paths, currentDir, searchPaths) =>
      providesModules && (Array.isArray(paths) ? paths : [paths]).some(candidate => /[#@]/.test(candidate))
        ? load().then(plugin => (plugin.resolve ?? defaults.resolve.bind(defaults))(paths, currentDir, searchPaths))
        : defaults.resolve(paths, currentDir, searchPaths),
    locate: (candidates, currentDir) => defaults.locate(candidates, currentDir),
    getSource: absoluteFilePath => defaults.getSource(absoluteFilePath)
  };

  return new Proxy<PluginInterface>(unloaded, {
    get(target, prop) {
      const source: PluginInterface = loaded && Reflect.has(loaded, prop) ? loaded : target;
      const value: unknown = Reflect.get(source, prop, source);
      return typeof value === 'function' ? value.bind(source) : value;
    }
  });
}

/** The `AbstractPlugin` path handling a dialect plugin keeps until it loads. */
class DefaultPathPlugin extends AbstractPlugin {
  name = 'default-paths';
}

class DefaultCompilerStackImpl implements DefaultCompilerStack {
  private lessPluginResolver = new LessPluginResolver();
  private jessPluginInstance: PluginInterface | undefined;
  private scssPluginInstance: PluginInterface | undefined;
  private readonly cssPlugin = new CssPlugin();

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
    return this.jessPluginInstance ??= lazyDialectPlugin('jess', ['.jess'], false,
      async () => (await import('@jesscss/plugin-jess')).default());
  }

  private getOrCreateScssPlugin(): PluginInterface {
    return this.scssPluginInstance ??= lazyDialectPlugin('scss', ['.scss'], true,
      async () => (await import('@jesscss/plugin-scss')).default());
  }

  private defaultPlugins(context: CompilerPluginContext): readonly PluginInterface[] {
    return [
      nodeModulesPlugin({ basePath: context.resolutionBaseDir }),
      this.getOrCreateJessPlugin(),
      this.lessPluginResolver.getOrCreate(context.optionsFor('less'), [], context),
      this.getOrCreateScssPlugin(),
      this.cssPlugin
    ];
  }

  dispose(): void {
    this.lessPluginResolver.dispose();
    try {
      void this.scssPluginInstance?.dispose?.();
    } catch {
      // ignore cleanup failures
    }
    this.lessPluginResolver = new LessPluginResolver();
    this.jessPluginInstance = undefined;
    this.scssPluginInstance = undefined;
  }
}

export function createDefaultCompilerStack(scriptPluginResolveFrom: string): DefaultCompilerStack {
  return new DefaultCompilerStackImpl(scriptPluginResolveFrom);
}

export class DefaultCompiler extends BaseCompiler {
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
