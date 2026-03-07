/**
 * These are Less output CSS test files that Less 3.x
 * doesn't recognize as containing invalid CSS, or which
 * are invalid when output.
 */
export const invalidCSSOutput = [
  /** Intentionally produces invalid CSS */
  'tests-unit/import-inline/import-inline.css',
  'tests-unit/import-reference/import-reference.css',

  /** intentionally invalid property name */
  'tests-unit/property-name-interp/property-name-interp.css',

  /** invalid attribute selector */
  'tests-unit/css-3/css-3.css',

  /** invalid attribute selector */
  'tests-unit/selectors/selectors.css',

  /**
   * All of these contain a property with no value,
   * and/or a list with no value
   *
   * @todo - Non custom props with no value should be auto-removed (or be unset?)
   */
  'tests-unit/extract-and-length/extract-and-length.css',
  'tests-unit/functions/functions.css',
  'tests-unit/javascript/javascript.css',

  /** Contains invalid container query syntax: @container (width > 760px) not (height > 670px) */
  /** The 'not' keyword must be at the start of a query, not between conditions */
  'tests-unit/container/container.css'
];

export const notSameSerialized = [
  /** Serialization issues */
  /** Has a pi value that was not rounded properly */
  'tests-unit/plugin/plugin.css',
  /** It's valid but not formatted, which we're also testing */
  'tests-unit/plugin-module/plugin-module.css',
  'tests-unit/import/import.css',
  'tests-unit/import-interpolation/import-interpolation.css',
  'tests-unit/directives-bubling/directives-bubling.css'
];

/**
 * @todo - Fix with a PR to test data in Less repo
 *
 * These files contain invalid CSS which
 * the current production Less parser doesn't
 * catch. However, this parser extends a CSS
 * parser and therefore catches more errors.
 */
export const invalidLess: string[] = [
  /**
   * Jess simplifies calc expressions
   * in ways that Less doesn't, so output won't
   * match. It's tested separately in Jess tests.
   */
  // 'tests-unit/calc/calc.less',
  /** This file is full of errors. */
  // 'tests-unit/css-3/css-3.less',

  // 'tests-unit/css-guards/css-guards.less',
  // Currently failing parsing; treat as invalid until less-parser supports them fully.
  // 'tests-unit/extract-and-length/extract-and-length.less',
  // 'tests-unit/functions/functions.less',
  // 'tests-unit/mixins-interpolated/mixins-interpolated.less',

  'tests-unit/permissive-parse/permissive-parse.less',
  'tests-unit/permissive-parse/legacy/permissive-parse.less',
  'tests-unit/property-name-interp/property-name-interp.less',
  // 'tests-config/compression/compression.less',

  // // 'tests-config/math/parens-division/new-division.less',
  // 'tests-config/math-strict/css.less',
  // 'tests-unit/import/invalid-css.less',
  'tests-unit/import/import/invalid-css.less',

  /** Contains invalid `[prop=10%]` and other edge syntax */
  'tests-unit/selectors/selectors.less',

  // /**
  //  * This has a variable in a `@charset`, which definitely
  //  * should not be allowed.
  //  */
  'tests-unit/variables-in-at-rules/variables-in-at-rules.less',

  // Currently failing parsing; treat as invalid until less-parser supports them fully.
  // 'tests-unit/functions-each/functions-each.less',
  'tests-unit/functions/legacy/functions.less',
  'tests-unit/operations/operations.less'

  // /** Has an unsupported token - `alpha(opacity=@var)` */
  // 'tests-unit/variables/variables.less'
];