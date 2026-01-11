import * as path from 'path';
import mergeWith from 'lodash-es/mergeWith';
import { getConfig } from './config';
import {
  Context,
  type PrintOptions,
  type ErrorDiagnostic,
  type WarningDiagnostic,
  type JessError,
  toDiagnostic,
  logger
} from '@jesscss/core';
import { getOptions, type StylesConfig } from 'styles-config';
import type { PluginInterface } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';
import { outputDiagnostics } from './diagnostics';

export type ConfigOptions = StylesConfig & {
  /** Output file path for matching against output config options */
  outputFile?: string;
  /** Suppress warnings (similar to Less's suppressWarnings option) */
  suppressWarnings?: boolean;
  /** Break on first error (stop processing after first error). Default: true */
  breakOnError?: boolean;
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
    const fileConfig = filePath ? getConfig(filePath) : {};
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
          // String key - could be resolved from a plugin registry in the future
          // For now, we'll skip string keys as they need to be resolved elsewhere
          continue;
        } else {
          // PluginInterfaceBase instance - cast to PluginInterface (they're compatible)
          pluginMap.set(plugin.name, plugin as PluginInterface);
        }
      }
    }
    // Pass output options and compile options to Context
    // Use getOptions result which includes properly merged output options
    const contextOptions = {
      ...lessOptions,
      ...config.compile
    };

    // Create print options for CSS output
    const printOptions = {
      collapseNesting: lessOptions.collapseNesting ?? (Array.isArray(config.output) ? undefined : (config.output as any)?.collapseNesting)
    };

    return new Context(contextOptions, [...pluginMap.values()]);
  }

  async compile(filePath: string, options?: Partial<ConfigOptions>) {
    const context = this.createContext(filePath, options);

    try {
      const { node } = await context.getTree(filePath);

      const evald = await node.eval(context);

      // Output any collected diagnostics
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true
        });
      }

      return { tree: evald, context };
    } catch (err: any) {
      // If we have diagnostics, output them
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: options?.suppressWarnings ?? false,
          breakOnError: options?.breakOnError ?? true
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

      const css = tree.toString(printOptions);
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
          code: 'JESS0000',
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
        code: 'JESS0000',
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
