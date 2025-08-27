import * as path from 'path';
import { getConfig } from './config';
import {
  Context,
  type TreeContextOptions,
  type PluginInterface,
  // type JessError,
  logger
} from '@jesscss/core';
import merge from 'lodash-es/merge';
import lessPlugin from '@jesscss/plugin-less';

export type ConfigOptions = TreeContextOptions & {
  plugins?: PluginInterface[];
};

export class JessCompiler {
  constructor(
    public opts: ConfigOptions = {}
  ) {}

  /**
   * Create a context with the configured plugins
   */
  private createContext(filePath?: string): Context {
    const opts: ConfigOptions = merge({}, this.opts, filePath ? getConfig(path.dirname(filePath)) : {});
    const { plugins, ...rest } = opts;
    /** @todo Add CSS and Jess plugins */
    let corePlugins = [
      lessPlugin()
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
    return new Context(rest, [...pluginMap.values()]);
  }

  /**
   * Render CSS from a file path
   */
  async render(filePath: string) {
    const context = this.createContext(filePath);

    try {
      const { node } = await context.getTree(filePath);
      const evald = await node.eval(context);
      const css = evald.toString();
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
  } = {}) {
    const { filePath, language, extension } = options;
    const context = this.createContext(filePath);

    try {
      const { node } = await context.parseString(content, {
        filePath,
        type: language,
        extension
      });

      const evald = await node.eval(context);
      const css = evald.toString();
      return css;
    } catch (err: any) {
      logger.error(err.toString());
      throw err;
    }
  }
}
