import type { StylesConfig, LessOptions } from './types';

/**
 * Get Less plugin options by combining compile, output, and language.less settings
 */
export function getLessOptions(config: StylesConfig = {}): LessOptions {
  const { compile = {}, output = {}, language = {} } = config;
  const lessOptions = language.less ?? {};

  return {
    ...lessOptions,
    // Override with compile-level settings
    mathMode: lessOptions.mathMode ?? compile.mathMode,
    unitMode: lessOptions.unitMode ?? compile.unitMode,
    // Override with output-level settings
    collapseNesting: lessOptions.collapseNesting ?? output.collapseNesting,
    compress: lessOptions.compress ?? output.compress,
    sourceMap: lessOptions.sourceMap ?? output.sourceMap
  };
}
/**
 * Get Sass/SCSS plugin options by combining compile, output, and language.scss settings
 */
export function getScssOptions(config: StylesConfig = {}): Record<string, any> {
  const { compile = {}, output = {}, language = {} } = config;
  const scssOptions = language.scss ?? {};

  return {
    ...scssOptions,
    // Override with compile-level settings
    mathMode: scssOptions.mathMode ?? compile.mathMode,
    unitMode: scssOptions.unitMode ?? compile.unitMode,
    // Override with output-level settings
    collapseNesting: scssOptions.collapseNesting ?? output.collapseNesting,
    compress: scssOptions.compress ?? output.compress,
    sourceMap: scssOptions.sourceMap ?? output.sourceMap
  };
}

/**
 * Get Jess plugin options by combining compile, output, and language.jess settings
 */
export function getJessOptions(config: StylesConfig = {}): Record<string, any> {
  const { compile = {}, output = {}, language = {} } = config;
  const jessOptions = language.jess ?? {};

  return {
    ...jessOptions,
    // Override with compile-level settings
    mathMode: jessOptions.mathMode ?? compile.mathMode,
    unitMode: jessOptions.unitMode ?? compile.unitMode,
    // Override with output-level settings
    collapseNesting: jessOptions.collapseNesting ?? output.collapseNesting,
    compress: jessOptions.compress ?? output.compress,
    sourceMap: jessOptions.sourceMap ?? output.sourceMap
  };
}
