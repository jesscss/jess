import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '../src';
import { invalidLess } from '@jesscss/shared';

const testData = path.dirname(require.resolve('@less/test-data'));
const lessParser = new Parser();

describe('Less full-suite (minus invalid files)', () => {
  const files = glob.sync(path.join(testData, 'less/_main/*.less'));
  files
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .slice(0, 10)
    .forEach((file) => {
      it(`${file}`, () => {
        const contents = fs.readFileSync(path.join(testData, file), 'utf8');
        const { lexerResult, errors } = lessParser.parse(contents);
        expect(lexerResult.errors.length).toBe(0);
        expect(errors.length).toBe(0);
      });
    });
});
