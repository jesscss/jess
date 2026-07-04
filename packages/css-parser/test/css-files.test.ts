import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { parseCssFn } from '../src/grammar.js';


describe('regular CSS - local fixtures', () => {
  const baseDir = path.join(__dirname, 'css');
  glob.sync(path.join(baseDir, '**/*.css'))
    .sort()
    .forEach((file) => {
      if (!file.includes('errors')) {
        it(path.relative(baseDir, file), () => {
          const contents = fs.readFileSync(file, 'utf8');
          const { errors } = parseCssFn(contents);
          expect(errors.length).toBe(0);
          expect(errors.length).toBe(0);
        });
      }
    });
});
