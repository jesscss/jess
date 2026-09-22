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
