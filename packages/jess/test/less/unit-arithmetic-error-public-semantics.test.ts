import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { lessHarnessFunctionsPlugin, resolveLessTestDataRoot } from '../test-utils.js';

const TD = resolveLessTestDataRoot();
const unitErrorFix = 'Use compatible units, cancel compound units before emission, or use unit() to normalize the value.';

function makeCompiler() {
  return new Compiler({
    output: { collapseNesting: true },
    compile: {
      jsReadRoot: TD,
      plugins: [lessPlugin(), lessCompatPlugin({ plugins: [lessHarnessFunctionsPlugin] })],
      functionMode: 'error',
      unitMode: 'strict'
    }
  });
}

describe('Less unit arithmetic errors through the public AST route', () => {
  it('keeps a chained arithmetic diagnostic at its authored operand', async () => {
    await expect(makeCompiler().renderString(
      '.x { value: (1px * 1em / 1cm); }',
      { filePath: 'entry.less', extension: '.less' }
    )).rejects.toMatchObject({
      code: 'eval/invalid-unit-arithmetic',
      line: 1,
      column: 24,
      filePath: 'entry.less'
    });
  });

  it.each([
    [
      'add-mixed-units',
      'tests-error/eval/add-mixed-units.less',
      'Incompatible units. Change the units or use the unit function. Bad units: \'px\' and \'em\'.',
      2,
      15
    ],
    [
      'divide-mixed-units',
      'tests-error/eval/divide-mixed-units.less',
      'Multiple units in dimension. Correct the units or use the unit function',
      2,
      15
    ],
    [
      'multiply-mixed-units',
      'tests-error/eval/multiply-mixed-units.less',
      'Multiple units in dimension. Correct the units or use the unit function',
      6,
      15
    ]
  ])('reports %s as a structured eval diagnostic', async (_label, fixture, reason, line, column) => {
    const result = await makeCompiler().renderToResult(path.join(TD, fixture), {
      breakOnError: false,
      suppressWarnings: true
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'eval/invalid-unit-arithmetic',
      phase: 'eval',
      message: 'Invalid unit arithmetic',
      reason,
      fix: unitErrorFix,
      line,
      column,
      filePath: expect.stringContaining(path.basename(fixture))
    });
  });
});
