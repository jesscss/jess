import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { parseFlatCssDeclarationStylesheet } from '../src/index.js';

describe('parseFlatCssDeclarationStylesheet corpus scan', () => {
  const baseDir = path.join(__dirname, 'css');
  glob.sync(path.join(baseDir, '**/*.css'))
    .sort()
    .forEach((file) => {
      if (file.includes(`${path.sep}errors${path.sep}`)) {
        return;
      }

      test(path.relative(baseDir, file), () => {
        const contents = fs.readFileSync(file, 'utf8');
        const result = parseFlatCssDeclarationStylesheet(file, contents);

        expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
      });
    });
});
