import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { JessCompiler } from '../../src';
import lessPlugin from '@jesscss/plugin-less';

const testData = path.dirname(require.resolve('@less/test-data'));

// Test nesting behavior specifically
const nestingCompiler = new JessCompiler({
  output: { collapseNesting: true }, // Test nesting collapsing
  compile: {
    plugins: [
      lessPlugin({
        mathMode: 0
      })
    ]
  },
  language: {} // Required by StylesConfig
});

describe('Nesting Behavior', () => {
  // Only test files that are specifically about nesting
  const nestingFiles = glob.sync(path.join(testData, 'tests-unit/nesting/*.less'));

  nestingFiles
    .map(value => path.relative(testData, value))
    .sort()
    .forEach((file) => {
      it(`should handle nesting in ${file}`, async () => {
        const lessPath = path.join(testData, file);
        const cssPath = lessPath.replace(/\.less$/, '.css').replace('/less/', '/css/');

        if (!fs.existsSync(cssPath)) {
          console.warn(`No expected CSS file found for ${file}, skipping test`);
          return;
        }

        const expectedCss = fs.readFileSync(cssPath).toString();
        const output = await nestingCompiler.render(lessPath);

        // Normalize whitespace for comparison
        const normalizedOutput = output.trim().replace(/\s+/g, ' ');
        const normalizedExpected = expectedCss.trim().replace(/\s+/g, ' ');

        expect(normalizedOutput).toBe(normalizedExpected);
      });
    });
});

    });
});
