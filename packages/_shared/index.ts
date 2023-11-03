/**
 * @todo - Fix with a PR to test data in Less repo
 *
 * These files contain invalid CSS which
 * the current production Less parser doesn't
 * catch. However, this parser extends a CSS
 * parser and therefore catches more errors.
 */
export const invalidLess = [
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
]