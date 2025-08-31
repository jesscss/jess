/**
 * These are Less output CSS test files that Less 3.x
 * doesn't recognize as containing invalid CSS, or which
 * are invalid when output.
 */
export const invalidCSSOutput = [
  /** Intentionally produces invalid CSS */
  'css/_main/import-inline.css',
  'css/_main/import-reference.css',

  /** intentionally invalid property name */
  'css/_main/property-name-interp.css',

  /** invalid attribute selector */
  'css/_main/css-3.css',

  /** invalid attribute selector */
  'css/_main/selectors.css',

  /**
   * All of these contain a property with no value,
   * and/or a list with no value
   *
   * @todo - Non custom props with no value should be auto-removed (or be unset?)
   */
  'css/_main/extract-and-length.css',
  'css/_main/functions.css',
  'css/_main/javascript.css'
];

export const notSameSerialized = [
  /** Serialization issues */
  /** Has a pi value that was not rounded properly */
  'css/_main/plugin.css',
  /** It's valid but not formatted, which we're also testing */
  'css/_main/plugin-module.css',
  'css/_main/import.css',
  'css/_main/import-interpolation.css',
  'css/_main/directives-bubling.css'
];

/**
 * @todo - Fix with a PR to test data in Less repo
 *
 * These files contain invalid CSS which
 * the current production Less parser doesn't
 * catch. However, this parser extends a CSS
 * parser and therefore catches more errors.
 */
export const invalidLess = [
  /**
   * Jess simplifies calc expressions
   * in ways that Less doesn't, so output won't
   * match. It's tested separately in Jess tests.
   */
  'less/_main/calc.less',
  /** This file is full of errors. */
  'less/_main/css-3.less',

  'less/_main/css-guards.less',
  'less/_main/extract-and-length.less',
  'less/_main/functions.less',
  'less/_main/mixins-interpolated.less',

  /** @todo */
  'less/_main/permissive-parse.less',
  'less/_main/property-name-interp.less',
  'less/compression/compression.less',

  // 'less/math/parens-division/new-division.less',
  'less/math/strict/css.less',
  'less/_main/import/invalid-css.less',

  /** Contains invalid `[prop=10%]` */
  'less/_main/selectors.less',

  /**
   * This has a variable in a `@charset`, which definitely
   * should not be allowed.
   */
  'less/_main/variables-in-at-rules.less',

  /** Has an unsupported token - `alpha(opacity=@var)` */
  'less/_main/variables.less'
];