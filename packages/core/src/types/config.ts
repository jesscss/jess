import type { FunctionMode, MathMode, UnitMode } from './modes.js';

export type { FunctionMode, MathMode, UnitMode };
export type SelectorPolicyKind = 'class' | 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound' | 'placeholder';
export type ExtendSelectorKind = SelectorPolicyKind;
export type ApplySelectorKind = SelectorPolicyKind;

/**
 * Whether/how to flatten nested selectors. `true` is a deprecated alias for
 * `'native'`; see `LessOptions.collapseNesting` in `styles-config`.
 */
export type CollapseNesting = boolean | 'native' | 'compact';

/** The Less-compatible source-map sub-options. */
export interface SourceMapOptions {
  sourceMapFullFilename?: string;
  sourceMapRootpath?: string;
  sourceMapBasepath?: string;
  sourceMapURL?: string;
  sourceMapFileInline?: boolean;
  outputSourceFiles?: boolean;
  disableSourcemapAnnotation?: boolean;
  sourceMapOutputFilename?: string;
  sourceMapFilename?: string;
}

/** Output options shared by the compile context and `styles.config` output entries. */
export interface OutputOptions {
  collapseNesting?: CollapseNesting;
  compress?: boolean;

  /**
   * Source-map generation. `true` turns it on with defaults; the object form
   * carries the Less-compatible sub-options.
   */
  sourceMap?: boolean | SourceMapOptions;
}
