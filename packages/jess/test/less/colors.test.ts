import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { resolveLessTestDataRoot } from '../test-utils.js';

const testData = resolveLessTestDataRoot();

// Test color functions without nesting collapsing
const colorCompiler = new Compiler({
  output: {
    collapseNesting: true
  },
  compile: {
    plugins: [
      lessPlugin({
        mathMode: 'always'
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

/*
 * Colour equality reads the channels. `darken()` is an HSL op whose result once
 * carried placeholder `[0, 0, 0]` channels, so any two darkened colours of the same
 * alpha compared equal (jess#348).
 */
describe('computed colour equality', () => {
  it('compares HSL-op results by their real channels', async () => {
    const result = await colorCompiler.renderToResult(
      {
        source: '.differ when (darken(red, 10%) = darken(blue, 10%)) { a: wrong; }\n'
          + '.same when (darken(red, 10%) = darken(red, 10%)) { a: right; }\n'
          + '@x: darken(red, 10%);\n@y: darken(blue, 10%);\n'
          + '.var-differ when (@x = @y) { a: wrong; }\n'
          + '.if { a: if((@x = @y), wrong, right); }\n',
        filePath: '/virtual/computed-colour-equality.less',
        language: 'less',
        extension: '.less'
      },
      { suppressWarnings: true, breakOnError: false }
    );
    expect(result.errors).toEqual([]);
    expect(result.css).not.toContain('wrong');
  });
});
