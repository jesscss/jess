import {
  Compiler as BaseCompiler,
  type CompilerHooks,
  type CompilerPluginContext,
  type ConfigOptions
} from '@jesscss/compiler';
import type { PluginInterface } from '@jesscss/core';
import jessPlugin from '@jesscss/plugin-jess';
import { LessPluginResolver, prepareLessRootSource } from '@jesscss/plugin-less';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';
import scssPlugin from '@jesscss/plugin-scss';

export type { ConfigOptions } from '@jesscss/compiler';

export interface DefaultCompilerStack {
  readonly hooks: CompilerHooks;
  dispose(): void;
}

class DefaultCompilerStackImpl implements DefaultCompilerStack {
  private lessPluginResolver = new LessPluginResolver();
  private jessPluginInstance: PluginInterface | undefined;
  private scssPluginInstance: PluginInterface | undefined;

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
      this.lessPluginResolver.getOrCreate(context.optionsFor('less')),
      this.getOrCreateScssPlugin()
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
