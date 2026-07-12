import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const testData = path.dirname(require.resolve('@less/test-data'));

// Test color functions without nesting collapsing
const colorCompiler = new Compiler({
  output: {
    collapseNesting: true
  },
  compile: {
    plugins: [
      lessPlugin({
        mathMode: 0
      })
    ]
  }
});

describe('Color Functions', () => {
  const colorFiles = glob.sync(path.join(testData, 'tests-unit/color-functions/*.less'));

  colorFiles
    .map(value => path.relative(testData, value))
    .sort()
    .forEach((file) => {
      it(`should handle ${file}`, async () => {
        const lessPath = path.join(testData, file);
        const cssPath = lessPath.replace(/\.less$/, '.css').replace('/less/', '/css/');

        if (!fs.existsSync(cssPath)) {
          console.warn(`No expected CSS file found for ${file}, skipping test`);
          return;
        }

        const expectedCss = fs.readFileSync(cssPath).toString();
        const output = await colorCompiler.render(lessPath);

        // Normalize whitespace for comparison
        const normalizedOutput = output.trim().replace(/\s+/g, ' ');
        const normalizedExpected = expectedCss.trim().replace(/\s+/g, ' ');

        expect(normalizedOutput).toBe(normalizedExpected);
      });
    });
});
