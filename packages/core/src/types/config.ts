import type { FunctionMode, MathMode, UnitMode } from './modes.js';

export type { FunctionMode, MathMode, UnitMode };
export type SelectorPolicyKind = 'class' | 'simple' | 'basic' | 'pseudo' | 'complex' | 'compound' | 'placeholder';
export type ExtendSelectorKind = SelectorPolicyKind;
export type ApplySelectorKind = SelectorPolicyKind;

/**
 * Whether/how to flatten nested selectors. A serialization option of the
 * compiler: it applies to all output, whatever the source dialect.
 * - `false` (default): keep authored nesting, emit no `:is()`.
 * - `'native'`: flatten with native CSS Nesting specificity and matching —
 *   parent wrapped in `:is()`; a child selector list folds into `:is(…)` only
 *   where every folded branch has the same specificity.
 * - `'compact'`: like `'native'`, but fold every same-combinator descendant
 *   child run into a single `:is(…)` (group-max specificity).
 * `true` is a deprecated alias for `'native'`.
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
