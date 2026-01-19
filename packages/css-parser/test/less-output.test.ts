import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { CssParser } from '../src/index.js';
import { invalidCSSOutput, notSameSerialized } from '@jesscss/shared';

const testData = path.dirname(require.resolve('@less/test-data'));
const cssParser = new CssParser({ legacyMode: true });

describe('Less CSS output - valid cases', () => {
  glob.sync(path.join(testData, 'tests-unit/*/permissive-parse.css'))
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
  glob.sync(path.join(testData, 'tests-unit/*/*.css'))
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
