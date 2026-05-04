import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import * as path from 'path';
import lessPlugin from '@jesscss/plugin-less';
import { Compiler } from '../../src/index.js';
import { outputDiagnostics } from '../../src/diagnostics.js';
import type { Rules } from '@jesscss/core';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));
const fixtureRelPath = 'tests-unit/detached-rulesets/detached-rulesets.less';
const fixturePath = path.join(testData, fixtureRelPath);
const expectedPath = fixturePath.replace(/\.less$/, '.css');

describe.todo('Less fixture parity', () => {
  it('matches detached-rulesets.less expected CSS', async () => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessPlugin()]
      }
    });
    const expectedCss = readFileSync(expectedPath, 'utf8');
    const context = compiler.createContext(fixturePath, { outputFile: expectedPath });
    let node: Rules;
    try {
      ({ node } = await context.getTree(fixturePath));
    } catch (error: any) {
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: false,
          breakOnError: false
        });
      }
      throw error;
    }
    try {
      const evald = await node.eval(context);
      expect(evald.toString({ context })).toBe(expectedCss);
    } catch (error: any) {
      if (context.errors.length > 0 || context.warnings.length > 0) {
        outputDiagnostics(context.errors, context.warnings, {
          suppressWarnings: false,
          breakOnError: false
        });
      }
      throw error;
    }
  }, 5000);
});
