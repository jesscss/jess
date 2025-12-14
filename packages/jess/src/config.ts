import { cosmiconfigSync, defaultLoadersSync } from 'cosmiconfig';
import * as path from 'path';
import type { StylesConfig } from '@jesscss/core';

const explorerSync = cosmiconfigSync('styles', {
  searchPlaces: [
    'styles.config.ts',
    'styles.config.js',
    'styles.config.mts',
    'styles.config.mjs',
    'styles.config.cjs',
    'styles.config.cts'
  ],
  // cosmiconfig has built-in loaders for .js, .ts, .mjs, .cjs
  // Add loaders for .mts and .cts to use the same TypeScript loader
  loaders: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.mts': defaultLoadersSync['.ts'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.cts': defaultLoadersSync['.ts'],
    // .mjs uses .js loader, .cjs has its own loader
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.mjs': defaultLoadersSync['.js'],
    // eslint-disable-next-line @typescript-eslint/naming-convention
    '.cjs': defaultLoadersSync['.cjs']
  }
});

/**
 * Get configuration from styles.config.* file, searching from the given directory
 * up through parent directories.
 *
 * @param searchFrom - File or directory path to start searching from (searches up to root)
 * @returns Configuration object, or empty object if no config found
 */
export const getConfig = (searchFrom?: string): Record<string, any> => {
  const result = explorerSync.search(searchFrom);

  if (!result?.config) {
    return {};
  }

  // Handle default export (common in ES modules)
  const config = result.config;
  if (typeof config === 'object' && config !== null && 'default' in config) {
    return config.default as Record<string, any>;
  }

  return config ?? {};
};

export interface OutputTestConfig {
  file: string;
  config: Partial<StylesConfig>;
}

/**
 * Get the expected output CSS file(s) and config(s) for testing.
 *
 * Supports:
 * - No output config: Returns default {name}.css with empty config
 * - Single output object: `output: { file: "{name}.css", collapseNesting: false, ... }`
 *   - Returns the file and uses those options for compilation
 * - Multiple outputs array: `output: [{ file: "{name}.css", ... }, ...]`
 *   - Returns array of {file, config} objects - test should iterate and test each
 * - Default options: First object in array without `file` property provides defaults
 *
 * @param lessFilePath - Path to the LESS file
 * @returns Single output config, or array of output configs if multiple outputs defined
 */
export function getExpectedOutputFiles(
  lessFilePath: string
): OutputTestConfig | OutputTestConfig[] {
  const config = getConfig(lessFilePath);
  const outputConfig = config.output;

  // Extract file name without extension for {name} replacement
  const dir = path.dirname(lessFilePath);
  const name = path.basename(lessFilePath, path.extname(lessFilePath));

  // No output config, default to {name}.css
  if (!outputConfig) {
    return {
      file: path.join(dir, `${name}.css`),
      config: {}
    };
  }

  // Handle single output object
  if (!Array.isArray(outputConfig)) {
    const file = outputConfig.file || '{name}.css';
    const outputFile = file.replace('{name}', name);

    // Extract config options (everything except 'file')
    const { file: _, ...configOptions } = outputConfig;
    return {
      file: path.join(dir, outputFile),
      config: { output: configOptions }
    };
  }

  // Handle array of outputs
  if (outputConfig.length === 0) {
    return {
      file: path.join(dir, `${name}.css`),
      config: {}
    };
  }

  // First object without 'file' property is default options
  let defaultOptions: Record<string, any> = {};
  let startIndex = 0;

  if (!('file' in outputConfig[0])) {
    defaultOptions = { ...outputConfig[0] };
    startIndex = 1;
  }

  // Build array of output configs
  const outputs: OutputTestConfig[] = [];

  for (let i = startIndex; i < outputConfig.length; i++) {
    const output = outputConfig[i];
    if (!output || typeof output !== 'object' || !('file' in output)) {
      continue;
    }

    // Merge default options with this output's options
    const { file: outputFile, ...outputOptions } = output;
    const mergedOptions = { ...defaultOptions, ...outputOptions };

    const file = outputFile || '{name}.css';
    const finalFile = file.replace('{name}', name);

    outputs.push({
      file: path.join(dir, finalFile),
      config: { output: mergedOptions }
    });
  }

  // If only one output, return it directly (not as array)
  if (outputs.length === 1) {
    return outputs[0];
  }

  // Return array if multiple outputs
  return outputs.length > 0
    ? outputs
    : [{
        file: path.join(dir, `${name}.css`),
        config: {}
      }];
}