import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { CssParser } from '../src';

const testData = path.dirname(require.resolve('@less/test-data'));
const cssParser = new CssParser({ legacyMode: true });

/**
 * These are Less output CSS test files that Less 3.x
 * doesn't recognize as containing invalid CSS, or which
 * are invalid when output.
 */
const invalidCSSOutput = [
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

const notSameSerialized = [
  /** Serialization issues */
  /** Has a pi value that was not rounded properly */
  'css/_main/plugin.css',
  /** It's valid but not formatted, which we're also testing */
  'css/_main/plugin-module.css',
  'css/_main/import.css',
  'css/_main/import-interpolation.css',
  'css/_main/directives-bubling.css'
];

describe('Less CSS output - valid cases', () => {
  glob.sync(path.join(testData, 'css/_main/*.css'))
    .map(value => path.relative(testData, value))
    .filter(value => !invalidCSSOutput.includes(value))
    .sort()
    .forEach((file) => {
      it(file, () => {
        const contents = fs.readFileSync(path.join(testData, file), 'utf8');
        const { tree, lexerResult, errors } = cssParser.parse(contents);
        // Some Less outputs can contain minor parse notes; assert no hard errors
        if (errors.length > 0) {
          // Log details to debug regressions in a Vitest-compatible way
          // Only log for the two files currently regressing to reduce noise
          console.error('Parse errors for', file, errors.map(e => e.message));
          const err = errors[0] as any;
          const off = err?.token?.startOffset ?? 0;
          const start = Math.max(0, off - 60);
          const end = Math.min(contents.length, off + 60);
          const excerpt = contents.slice(start, end).replace(/\n/g, '\\n');
          console.error('Near offset', off, '... ', excerpt);
        }
        expect(lexerResult.errors.length).toBe(0);
        expect(errors.length).toBe(0);
        if (!(['test/css/custom-properties.css'].includes(file)) && !(notSameSerialized.includes(file))) {
          // Print a short diff-friendly message instead of throwing if contents missing
          expect(`${tree}`).toBe(contents);
        }
      });
    });
});

describe('Less CSS output - invalid cases', () => {
  glob.sync(path.join(testData, 'css/_main/*.css'))
    .map(value => path.relative(testData, value))
    .filter(value => invalidCSSOutput.includes(value))
    .sort()
    .forEach((file) => {
      it(file, () => {
        const contents = fs.readFileSync(path.join(testData, file), 'utf8');
        const { lexerResult, errors } = cssParser.parse(contents);
        expect(lexerResult.errors.length).toBe(0);
        expect(errors.length).toBeGreaterThan(0);
      });
    });
});
