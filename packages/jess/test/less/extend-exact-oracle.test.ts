import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { resolveLessTestDataRoot } from '../test-utils.js';

const testData = resolveLessTestDataRoot();

/**
 * These upstream fixtures exercise exact extends whose visible result is not a
 * naive selector-list append.  In particular, nested source bodies and `&&`
 * composition keep the authored target header while the extender's result is
 * emitted at its own placement.  Keep this at the public Compiler boundary:
 * the old tree/extend prototype represented all three as `.target,.extender`
 * and therefore reported false direct-AST "gaps".
 */
describe('Less exact-extend oracle routing', () => {
  const compiler = new Compiler({
    output: { collapseNesting: false },
    compile: { plugins: [lessPlugin()] }
  });

  for (const rel of [
    'tests-unit/extend/extend.less',
    'tests-unit/extend-exact/extend-exact.less',
    'tests-unit/extend-selector/extend-selector.less'
  ]) {
    it(`renders ${rel} byte-identically through the public AST-v2 route`, async () => {
      const lessPath = path.join(testData, rel);
      const expectedPath = lessPath.replace(/\.less$/, '.css');
      const expected = readFileSync(expectedPath, 'utf8');

      const result = await compiler.renderToResult(lessPath, {
        outputFile: expectedPath
      });

      expect(result.errors).toEqual([]);
      expect(result.css).toBe(expected);
    });
  }
});
