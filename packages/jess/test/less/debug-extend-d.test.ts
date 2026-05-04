import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

describe.todo('Debug extend .d issue - minimal repro', () => {
  it('should not include .d in extend result (with collapseNesting)', async () => {
    const lessPath = path.join(testData, 'tests-unit/extend-selector/extend-selector.less');
    const cssPath = path.join(testData, 'tests-unit/extend-selector/extend-selector.css');

    const lessCode = readFileSync(lessPath, 'utf-8');
    const expectedCss = readFileSync(cssPath, 'utf-8');

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessPlugin()]
      }
    });

    const context = compiler.createContext(lessPath);
    const { node } = await context.getTree(lessPath);
    const evald = await node.eval(context);
    const css = evald.toString({ context });

    // Focus on the specific failing case - lines 9-12 of expected CSS
    const expectedExtend = '.ext,\n:is(.a, .b) .c {';
    const actualExtend = css.split('\n').slice(8, 11).join('\n');

    console.log('Expected extend section:', expectedExtend);
    console.log('Actual extend section:', actualExtend);

    // Check that .c .d is NOT in the extend result
    expect(actualExtend).not.toContain('.c .d');
    expect(actualExtend).toContain(':is(.a, .b) .c {');
  });

  it('should not include .d in extend result (without collapseNesting)', async () => {
    const lessPath = path.join(testData, 'tests-unit/extend-selector/extend-selector.less');
    const cssPath = path.join(testData, 'tests-unit/extend-selector/extend-selector.css');

    const lessCode = readFileSync(lessPath, 'utf-8');
    const expectedCss = readFileSync(cssPath, 'utf-8');

    const compiler = new Compiler({
      output: { collapseNesting: false },
      compile: {
        plugins: [lessPlugin()]
      }
    });

    const context = compiler.createContext(lessPath);
    const { node } = await context.getTree(lessPath);
    const evald = await node.eval(context);
    const css = evald.toString({ context });

    // Focus on the specific failing case - lines 9-12 of expected CSS
    const expectedExtend = '.ext,\n:is(.a, .b) .c {';
    const actualExtend = css.split('\n').slice(8, 11).join('\n');

    console.log('Expected extend section (no collapse):', expectedExtend);
    console.log('Actual extend section (no collapse):', actualExtend);

    // Check that .c .d is NOT in the extend result
    expect(actualExtend).not.toContain('.c .d');
    expect(actualExtend).toContain(':is(.a, .b) .c {');
  });
});
