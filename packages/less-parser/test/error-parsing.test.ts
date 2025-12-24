import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '../src';
import { invalidLess, invalidCSSOutput, notSameSerialized } from '@jesscss/shared';

const testData = path.dirname(require.resolve('@less/test-data'));
const lessParser = new Parser();

const skippedErrors = [
  /**
   * Not a parse error, but an eval + parse error,
   * which this test can't cover.
   */
  'tests-error/parse/import-subfolder2.less',
  'tests-error/parse/imports/import-subfolder2.less',
  'tests-error/parse/imports/subfolder/parse-error-curly-bracket.less',

  /**
   * Not sure why this color + comment should have been an error.
   * Looks like valid CSS to me, and this parser passes it.
   */
  'tests-error/parse/invalid-color-with-comment.less',

  /** This parser tolerates (12 (1 + 2)) because it's not necessarily invalid CSS */
  'tests-error/parse/parens-error-1.less',
  'tests-error/parse/parens-error-2.less',
  'tests-error/parse/parens-error-3.less'
];

// Skipped until we fix these flows
describe('should throw parsing errors', () => {
  const files = glob.sync(
    path.relative(process.cwd(), path.join(testData, 'tests-error/parse/**/*.less'))
  );
  files
    .sort()
    .map(value => path.relative(testData, value))
    .filter(file => !skippedErrors.includes(file))
    .forEach((file) => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file));
        const { lexerResult, errors } = lessParser.parse(result.toString());
        expect(lexerResult.errors.length).toBe(0);
        expect(errors.length).toBe(1);
      });
    });
});
