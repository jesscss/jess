import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '../src/index.js';
import { invalidLess } from '@jesscss/shared';
import { resolveLessTestDataRoot } from './test-data.js';

const testData = resolveLessTestDataRoot();
const lessParser = new Parser();

describe('Less full-suite (minus invalid files)', () => {
  const files = glob.sync(path.join(testData, 'tests-config/**/*.less'));
  files
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .filter(value => !value.includes('-REMOVED'))
    .sort()
    .forEach((file) => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file));
        const contents = result.toString();
        const { errors } = lessParser.parse(contents);
        if (errors.length) {
          // Log details to debug regressions in a Vitest-compatible way
          console.error('Parse errors for', file, errors.map(e => e.message));
          const err: any = errors[0];
          const line = err?.token?.startLine ?? 0;
          if (line) {
            console.error('Near line', line, '... ', contents.split('\n')[line - 1]);
          }
        }
        expect(errors.length).toBe(0);

        /** JavaScript tokens are skipped */
        // if (!([
        //   'less/_main/javascript.less',
        //   'less/no-js-errors/no-js-errors.less'
        // ].includes(file))) {
        //   const output = stringify(cst)
        //   expect(output).toBe(contents)
        // }
      });
      // }
    });
});
