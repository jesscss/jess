import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { CssParser } from '../src/index.js';

const cssParser = new CssParser();

describe('regular CSS - local fixtures', () => {
  const baseDir = path.join(__dirname, 'css');
  glob.sync(path.join(baseDir, '**/*.css'))
    .sort()
    .forEach((file) => {
      if (!file.includes('errors')) {
        it(path.relative(baseDir, file), () => {
          const contents = fs.readFileSync(file, 'utf8');
          const { lexerResult, errors } = cssParser.parse(contents);
          expect(lexerResult.errors.length).toBe(0);
          expect(errors.length).toBe(0);
        });
      }
    });
});
