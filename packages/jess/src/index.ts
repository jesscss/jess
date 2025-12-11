import * as path from 'path';
import { getConfig } from './config';
import {
  Context,
  type StylesConfig,
  type PluginInterface,
  type PrintOptions,
  // type JessError,
  logger
} from '@jesscss/core';
import merge from 'lodash-es/merge';
import lessPlugin from '@jesscss/plugin-less';

export type ConfigOptions = StylesConfig;

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
  private createContext(filePath?: string, renderOptions?: Partial<ConfigOptions>): Context {
    const config: ConfigOptions = merge({
      compile: {},
      output: {},
      language: {}
    }, this.opts, filePath ? getConfig(path.dirname(filePath)) : {}, renderOptions || {});
    // Extract plugins from compile.plugins
    const plugins = config.compile?.plugins;
    /** @todo Add CSS and Jess plugins */
    let corePlugins = [
      lessPlugin(config.language?.less || {})
    ];
    const pluginMap = new Map<string, PluginInterface>();
    /** This can be used to override the core plugin settings */
    for (const plugin of corePlugins) {
      pluginMap.set(plugin.name, plugin);
    }
    if (plugins) {
      for (const plugin of plugins) {
        pluginMap.set(plugin.name, plugin);
      }
    }
    // Pass output options and compile options to Context
    const contextOptions = {
      ...config.output,
      ...config.compile,
      collapseNesting: config.output?.collapseNesting
    };

    // Create print options for CSS output
    const printOptions = {
      collapseNesting: config.output?.collapseNesting
    };

    return new Context(contextOptions, [...pluginMap.values()]);
  }

  /**
   * Render CSS from a file path
   */
  async render(filePath: string, options?: Partial<ConfigOptions>) {
    const context = this.createContext(filePath, options);

    try {
      const { node } = await context.getTree(filePath);
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
}
