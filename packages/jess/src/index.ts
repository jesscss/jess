import * as path from 'path';
import { createRequire } from 'node:module';
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

const require = createRequire(import.meta.url);

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

const maybeLoadJsPlugin = (
  jsConfig: JavaScriptSandboxConfig
): PluginInterface | undefined => {
  try {
    require.resolve('@jesscss/plugin-js/package.json');

    let pluginPromise: Promise<PluginInterface> | undefined;
    const getPlugin = async (): Promise<PluginInterface> => {
      if (!pluginPromise) {
        pluginPromise = import('@jesscss/plugin-js').then((mod: any) => {
          const pluginFactory = (mod?.default ?? mod) as ((opts?: JavaScriptSandboxConfig) => PluginInterface);
          return pluginFactory(jsConfig);
        });
      }
      return pluginPromise;
    };

    const pluginProxy: PluginInterface & { prewarm?: () => Promise<void> } = {
      name: 'js',
      supportedExtensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
      prewarm: async () => {
        const plugin = await getPlugin();
        if (typeof (plugin as any).prewarm === 'function') {
          await (plugin as any).prewarm();
        }
      },
      import: async (absoluteFilePath: string) => {
        const plugin = await getPlugin();
        if (!plugin.import) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable script execution features.');
        }
        return plugin.import(absoluteFilePath);
      }
    };
    return pluginProxy;
  } catch (err: any) {
    // Only ignore module-not-found for optional dependency resolution.
    if (
      err?.code === 'MODULE_NOT_FOUND'
      && typeof err?.message === 'string'
      && err.message.includes('@jesscss/plugin-js')
    ) {
      return undefined;
    }
    throw err;
  }
};

const maybeLoadConfiguredPlugin = (
  specifier: string
): (PluginInterface & { prewarm?: () => Promise<void> }) | undefined => {
  let pluginPromise: Promise<PluginInterface> | undefined;
  let loadedPlugin: PluginInterface | undefined;
  const getPlugin = async (): Promise<PluginInterface> => {
    if (!pluginPromise) {
      pluginPromise = import(specifier).then((mod: any) => {
        const pluginFactoryOrInstance = mod?.default ?? mod?.lessCompatPlugin ?? mod?.plugin ?? mod;
        const plugin = typeof pluginFactoryOrInstance === 'function'
          ? pluginFactoryOrInstance()
          : pluginFactoryOrInstance;
        if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
          throw new Error(`Configured plugin "${specifier}" did not resolve to a valid plugin instance`);
        }
        loadedPlugin = plugin as PluginInterface;
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
      if (typeof value === 'function') {
        return value.bind(loadedPlugin);
      }
      return value;
    }
  }) as PluginInterface & { prewarm?: () => Promise<void> };
};

export class Compiler {
  constructor(
    public opts: ConfigOptions = {
      compile: {},
      output: {},
      language: {}
    }
  ) {}

  /**
   * Create a context with the configured plugins
   */
  createContext(filePath?: string, renderOptions?: Partial<ConfigOptions>): Context {
    // Merge order: file config -> compiler opts -> render options
    const { config: loadedFileConfig, configFilePath } = filePath
      ? getConfigWithMeta(path.dirname(filePath))
      : { config: {}, configFilePath: undefined };
    const fileConfig = loadedFileConfig;
    const baseConfig: ConfigOptions = {
      compile: {},
      output: {},
      language: {}
    };

    const config: ConfigOptions = mergeWith(
      baseConfig,
      fileConfig,
      this.opts,
      renderOptions || {},
      arrayConcatCustomizer
    );
    const normalizedCompileJavaScript = normalizeCompileJavaScript(config.compile?.javascript);
    const resolvedJsReadRoot = resolveJsReadRoot(normalizedCompileJavaScript, filePath, configFilePath);
    const jsPluginConfig: JavaScriptSandboxConfig = {
      ...(normalizedCompileJavaScript ?? {}),
      jsReadRoot: normalizedCompileJavaScript?.jsReadRoot
        ? path.resolve(normalizedCompileJavaScript.jsReadRoot)
        : resolvedJsReadRoot
    };
    // Extract plugins from compile.plugins
    const plugins = config.compile?.plugins;
    /** @todo Add CSS and Jess plugins */
    // Get merged options for each language using file-based matching
    // Use outputFile from renderOptions, or try to extract from config
    let resolvedOutputFilePath: string | undefined = renderOptions?.outputFile;
    if (!resolvedOutputFilePath) {
      if (Array.isArray(config.output)) {
        // If output is an array, we need the expected output file path to match
        // This should be provided via renderOptions.outputFile
      } else if (config.output && 'file' in config.output && (config.output as any).file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, (config.output as any).file.replace('{name}', name));
      } else if (renderOptions?.output && !Array.isArray(renderOptions.output) && 'file' in renderOptions.output && (renderOptions.output as any).file) {
        const dir = filePath ? path.dirname(filePath) : '.';
        const name = filePath ? path.basename(filePath, path.extname(filePath)) : 'output';
        resolvedOutputFilePath = path.join(dir, (renderOptions.output as any).file.replace('{name}', name));
      }
    }
    const lessOptions = getOptions(config, { language: 'less', input: filePath, output: resolvedOutputFilePath });
    let corePlugins = [
      lessPlugin(lessOptions)
    ];
    const pluginMap = new Map<string, PluginInterface>();
    /** This can be used to override the core plugin settings */
    for (const plugin of corePlugins) {
      pluginMap.set(plugin.name, plugin);
    }
    if (plugins) {
      for (const plugin of plugins) {
        if (typeof plugin === 'string') {
          if (plugin === '@jesscss/plugin-js') {
            const jsPlugin = maybeLoadJsPlugin(jsPluginConfig);
            if (jsPlugin) {
              pluginMap.set(jsPlugin.name, jsPlugin);
            }
            continue;
          }
          const loadedPlugin = maybeLoadConfiguredPlugin(plugin);
          if (loadedPlugin) {
            pluginMap.set(plugin, loadedPlugin);
          }
        } else {
          // PluginInterfaceBase instance - cast to PluginInterface (they're compatible)
          pluginMap.set(plugin.name, plugin as PluginInterface);
        }
      }
    }
    if (!pluginMap.has('js')) {
      const jsPlugin = maybeLoadJsPlugin(jsPluginConfig);
      if (jsPlugin) {
        pluginMap.set(jsPlugin.name, jsPlugin);
      }
    }
    // Eagerly load plugin-js when present so it sets globalThis (less-compat @plugin requires it to be present)
    if (pluginMap.has('js')) {
      try {
        createRequire(import.meta.url)('@jesscss/plugin-js');
      } catch {
        // optional: plugin-js may be missing; @plugin will throw at runtime if used
      }
    }
    // Pass output options and compile options to Context
    // Use getOptions result which includes properly merged output options
    const contextOptions = {
      ...lessOptions,
      ...config.compile
    };
    if (normalizedCompileJavaScript) {
      (contextOptions as any).javascript = jsPluginConfig;
    }

    const resolveMatchedOutputCollapseNesting = (): boolean | undefined => {
      if (!Array.isArray(config.output) || !resolvedOutputFilePath) {
        return undefined;
      }
      const outputEntries = config.output as Array<Record<string, any>>;
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

    // Create print options for CSS output.
    // For array output configs, infer the matched entry's collapseNesting using resolved outputFile.
    const matchedOutputCollapseNesting = resolveMatchedOutputCollapseNesting();
    const explicitOutputCollapseNesting = (
      !Array.isArray(config.output)
        ? (config.output as any)?.collapseNesting
        : undefined
    ) as boolean | undefined;
    const printOptions = {
      // Respect explicit output config first; lessOptions can carry defaults.
      collapseNesting: explicitOutputCollapseNesting
        ?? matchedOutputCollapseNesting
        ?? lessOptions.collapseNesting
    };

    // Ensure output options are available on context.opts.output.
    // Many serializer/hoisting behaviors (including Less extend materialization) consult output.collapseNesting.
    // Also mirror to top-level context option because selector/ruleset preEval paths consult context.opts.collapseNesting.
    (contextOptions as any).collapseNesting = printOptions.collapseNesting;
    (contextOptions as any).output = {
      ...(typeof (config.output as any) === 'object' && !Array.isArray(config.output) ? (config.output as any) : {}),
      collapseNesting: printOptions.collapseNesting
    };

    return new Context(contextOptions, [...pluginMap.values()]);
  }

  async compile(filePath: string, options?: Partial<ConfigOptions>) {
    const context = this.createContext(filePath, options);

    try {
      // Jess orchestrates visitor phases (not core):
      // - preEvalVisitor runs on the parsed tree (before any evaluation)
      // - postEvalVisitor runs on the evaluated tree (after eval)
      const applyPreEvalVisitors = (tree: any, currentFilePath: string) => {
        if (!tree || !context.plugins?.length) {
          return tree;
        }
        let current = tree;
        const processed = new Set<any>();
        // Two passes: match Less.js behavior where @plugin can add new visitors
        for (let pass = 0; pass < 2; pass++) {
          for (const plugin of context.plugins) {
            // Allow plugins to access the current compilation context if needed
            if (typeof (plugin as any).setContext === 'function') {
              try {
                (plugin as any).setContext(context);
              } catch {
                // ignore
              }
            }
            // Allow plugins to know the current file path if they need it (e.g. less-compat @plugin relative paths)
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
            for (const v of visitors) {
              if (!v || typeof v.visit !== 'function') {
                continue;
              }
              if (pass === 1 && processed.has(v)) {
                continue;
              }
              const result = current.accept ? current.accept(v) : current;
              if (result) {
                current = result;
              }
              processed.add(v);
            }
          }
        }
        return current;
      };

      const applyPostEvalVisitors = (tree: any) => {
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
          for (const v of visitors) {
            if (!v || typeof v.visit !== 'function') {
              continue;
            }
            const result = current.accept ? current.accept(v) : current;
            if (result) {
              current = result;
            }
          }
        }
        return current;
      };

      // Helper: best-effort fallback for file path when Context doesn't provide one
      const currentFilePathFromImport = (importPath: string, fallback: string) => {
        return typeof importPath === 'string' && importPath.length ? importPath : fallback;
      };

      // Ensure pre-eval visitors also run on trees loaded during evaluation (imports).
      // This keeps @plugin processing consistent for imported Less files.
      const originalGetTree = context.getTree.bind(context);
      context.getTree = async (importPath: string, importOptions: any = {}) => {
        const result = await originalGetTree(importPath, importOptions);
        const resolvedPath = result?.resolvedPath ?? currentFilePathFromImport(importPath, filePath);
        const processedTree = applyPreEvalVisitors(result.node, resolvedPath);
        if (processedTree && processedTree !== result.node) {
          result.node = processedTree;
          if (result.resolvedPath) {
            context.sourceTrees.set(result.resolvedPath, processedTree as any);
          }
        }
        return result;
      };

      // Eagerly initialize lazy configured plugins before parsing/evaluation so
      // parse/import hooks and visitors are available from the first file.
      for (const plugin of context.plugins) {
        if (typeof (plugin as any).prewarm === 'function') {
          await (plugin as any).prewarm();
        }
      }

      const { node } = await context.getTree(filePath);
      const preEvaldTree = applyPreEvalVisitors(node, filePath);
      const evald = await preEvaldTree.eval(context);
      const postEvald = applyPostEvalVisitors(evald);

      // Output any collected diagnostics
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false
        });
      }

      return { tree: postEvald, context };
    } catch (err: any) {
      // If we have diagnostics, output them
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true,
          verbose: options?.verbose ?? false
        });
      } else {
        // Fallback to logger for non-diagnostic errors
        logger.error(err.toString());
      }
      throw err;
    }
  }

  /**
   * Render CSS from a file path
   */
  async render(filePath: string, options?: Partial<ConfigOptions>) {
    try {
      const { tree, context } = await this.compile(filePath, options);

      const printOptions: PrintOptions = {
        collapseNesting: context.opts.collapseNesting,
        context
      };

      let css = tree.toString(printOptions);

      // Allow plugins to post-process final CSS (e.g. Less addPostProcessor via less-compat)
      for (const plugin of context.plugins || []) {
        if (typeof (plugin as any).runPostProcessors === 'function') {
          css = (plugin as any).runPostProcessors(css, {});
        } else if (typeof (plugin as any).postProcessCss === 'function') {
          css = (plugin as any).postProcessCss(css, context);
        }
      }

      return css;
    } catch (err: any) {
      // Diagnostics are already output by compile()
      // If it's not a diagnostic error, log it
      if (!(err && typeof err === 'object' && 'code' in err)) {
        logger.error(err.toString());
      }
      throw err;
    }
  }

  /**
   * Render CSS from a string content
   */
  async renderString(content: string, options: {
    filePath?: string;
    language?: string;
    extension?: string;
    config?: Partial<ConfigOptions>;
  } = {}) {
    const { filePath, language, extension, config: renderOptions } = options;
    const context = this.createContext(filePath, renderOptions);

    try {
      const { node } = await context.parseString(content, {
        filePath,
        type: language,
        extension
      });

      const evald = await node.eval(context);

      // Create print options with collapseNesting setting and context for charset handling
      const printOptions: PrintOptions = {
        collapseNesting: context.opts.collapseNesting,
        context
      };

      const css = evald.toString(printOptions);
      return css;
    } catch (err: any) {
      logger.error(err.toString());
      throw err;
    }
  }

  /**
   * Renders to CSS and returns a structured result object containing CSS and metadata.
   * Can accept either a file path or string content.
   * Similar to dart-sass's compileToResult() pattern, but uses "render" naming to match less.js.
   *
   * @param input - File path (string) or source content (object with source string)
   * @param options - Render options
   * @returns RenderResult with css, errors, warnings, and loadedUrls
   */
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
    // Determine if input is a file path or source content
    const isSourceContent = typeof input === 'object' && 'source' in input;
    const source = isSourceContent ? input.source : undefined;
    const filePath = isSourceContent ? input.filePath : input;
    const language = isSourceContent ? input.language : options?.language;
    const extension = isSourceContent ? input.extension : options?.extension;
    const renderOptions = isSourceContent ? options : options;

    const context = this.createContext(filePath, renderOptions);

    try {
      let evald;
      if (isSourceContent && source) {
        const { node } = await context.parseString(source, {
          filePath,
          type: language,
          extension
        });
        evald = await node.eval(context);
      } else {
        const { node } = await context.getTree(filePath!);
        evald = await node.eval(context);
      }

      const printOptions: PrintOptions = {
        collapseNesting: context.opts.collapseNesting,
        context
      };

      const css = evald.toString(printOptions);

      // Collect loaded URLs from context (if available)
      const loadedUrls: string[] = [];
      // TODO: Extract loaded URLs from context when that information is available

      return {
        css,
        errors: [...context.errors],
        warnings: [...context.warnings],
        loadedUrls
      };
    } catch (err: any) {
      // Convert error to diagnostic
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

      // Output diagnostics if configured
      if (renderOptions?.suppressWarnings !== true) {
        outputDiagnostics(errors, warnings, {
          suppressWarnings: renderOptions?.suppressWarnings ?? false,
          breakOnError: renderOptions?.breakOnError ?? true,
          verbose: renderOptions?.verbose ?? false
        });
      }

      const loadedUrls: string[] = [];
      return {
        css: '',
        errors,
        warnings,
        loadedUrls
      };
    }
  }

  /**
   * Safe version of compile that collects errors and warnings instead of throwing.
   * Returns the tree (or null if compilation failed) along with collected errors and warnings.
   */
  async safeCompile(filePath: string, options?: Partial<ConfigOptions>): Promise<{
    tree: any | null;
    context: Context;
    errors: ErrorDiagnostic[];
    warnings: WarningDiagnostic[];
  }> {
    const context = this.createContext(filePath, {
      ...options,
      breakOnError: false,
      suppressWarnings: options?.suppressWarnings ?? false
    });

    try {
      const { node } = await context.getTree(filePath);
      const evald = await node.eval(context);

      // Collect any errors and warnings from context
      return {
        tree: evald,
        context,
        errors: [...context.errors],
        warnings: [...context.warnings]
      };
    } catch (err: any) {
      // Convert error to diagnostic
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
          filePath: filePath,
          line: 1,
          column: 1
        });
      }

      return { tree: null, context, errors, warnings };
    }
  }

  /**
   * Safe version of render that collects errors and warnings instead of throwing.
   * Returns the CSS (or null if rendering failed) along with collected errors and warnings.
   */
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
      // This shouldn't happen in safe mode, but handle it just in case
      const errors: ErrorDiagnostic[] = [{
        code: 'internal/unknown',
        phase: 'eval',
        message: err?.message || 'Unknown error',
        reason: err?.message || 'An unexpected error occurred during rendering.',
        fix: 'Check the file and ensure it is valid.',
        filePath: filePath,
        line: 1,
        column: 1
      }];
      return { css: null, errors, warnings: [] };
    }
  }
}
