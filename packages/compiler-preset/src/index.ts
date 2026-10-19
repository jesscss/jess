import {
  Compiler as BaseCompiler,
  type CompilerHooks,
  type CompilerPluginContext,
  type ConfigOptions
} from '@jesscss/compiler';
import { AbstractPlugin, type ISafeParseResult, parserDiagnostic, type PluginInterface } from '@jesscss/core';
import { parse as parseCss } from '@jesscss/css-parser';
import jessPlugin from '@jesscss/plugin-jess';
import { LessPluginResolver, prepareLessRootSource } from '@jesscss/plugin-less';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';
import scssPlugin from '@jesscss/plugin-scss';

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
    let plugin = this.jessPluginInstance;
    if (!plugin) {
      plugin = jessPlugin();
      this.jessPluginInstance = plugin;
    }
    return plugin;
  }

  private getOrCreateScssPlugin(): PluginInterface {
    let plugin = this.scssPluginInstance;
    if (!plugin) {
      plugin = scssPlugin();
      this.scssPluginInstance = plugin;
    }
    return plugin;
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
