import {
  Compiler as BaseCompiler,
  type CompilerPluginContext,
  type ConfigOptions
} from '@jesscss/compiler';
import type { PluginInterface } from '@jesscss/core';
import jessPlugin from '@jesscss/plugin-jess';
import { LessPluginResolver, prepareLessRootSource } from '@jesscss/plugin-less';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';
import scssPlugin from '@jesscss/plugin-scss';

export type { ConfigOptions } from '@jesscss/compiler';

/**
 * Batteries-included Jess compiler. The reusable render engine lives in
 * `@jesscss/compiler`; this package only chooses Jess's default plugin stack
 * and CLI-oriented dialect behavior.
 */
export class Compiler extends BaseCompiler {
  /** @internal */
  declare public opts: ConfigOptions;

  private lessPluginResolver = new LessPluginResolver();
  private jessPluginInstance: PluginInterface | undefined;
  private scssPluginInstance: PluginInterface | undefined;

  constructor(opts: ConfigOptions = {
    compile: {},
    output: {},
    language: {}
  }) {
    super(opts, {
      defaultPlugins: context => this.defaultPlugins(context),
      normalizeConfiguredPlugin: (plugin, context) =>
        this.lessPluginResolver.normalizeConfiguredPlugin(plugin, context),
      prepareSource: prepareLessRootSource,
      scriptPluginSpecifier: '@jesscss/plugin-js',
      scriptPluginResolveFrom: import.meta.url
    });
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
      this.lessPluginResolver.getOrCreate(context.optionsFor('less')),
      this.getOrCreateScssPlugin()
    ];
  }

  override dispose(): void {
    super.dispose();
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
