import * as path from 'path';
import mergeWith from 'lodash-es/mergeWith';
import { getConfig } from './config';
import {
  Context,
  type StylesConfig,
  type PluginInterface,
  type PrintOptions,
  // type JessError,
  logger
} from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

export type ConfigOptions = StylesConfig;

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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:41', message: 'createContext entry', data: { filePath: filePath || 'none' }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
    // #endregion
    // Merge order: file config -> compiler opts -> render options
    // #region agent log
    if (filePath) { fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:44', message: 'createContext calling getConfig', data: { filePath }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {}); }
    // #endregion
    const fileConfig = filePath ? getConfig(filePath) : {};
    // #region agent log
    if (filePath) { fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:46', message: 'createContext getConfig completed', data: { filePath, hasConfig: !!fileConfig }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {}); }
    // #endregion
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

  async compile(filePath: string, options?: Partial<ConfigOptions>) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:92', message: 'render starting', data: { filePath }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
    // #endregion
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:95', message: 'calling createContext', data: { filePath }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
    // #endregion
    const context = this.createContext(filePath, options);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:97', message: 'createContext completed', data: { filePath }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
    // #endregion

    try {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:101', message: 'calling getTree', data: { filePath }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
      // #endregion
      const { node } = await context.getTree(filePath);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:101', message: 'getTree completed, starting eval', data: { nodeType: node.type, nodeIndex: node.index }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
      // #endregion

      const evald = await node.eval(context);
      return { tree: evald, context };
    } catch (err: any) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:115', message: 'render error', data: { error: err.toString() }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
      // #endregion
      logger.error(err.toString());
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

      const css = tree.toString(printOptions);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:112', message: 'toString completed', data: { cssLength: css.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
      // #endregion
      return css;
    } catch (err: any) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:115', message: 'render error', data: { error: err.toString() }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
      // #endregion
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
