import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { block, decl, dimension, funcCall, operation, quoted, rule, stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());

describe('direct canonical function-argument math', () => {
  it('evaluates division in Less function arguments when mathMode is always', () => {
    const document = stylesheet([
      rule('.math', [
        decl('rounded', funcCall('round', [operation('/', dimension(32), dimension(3))])),
        decl('percentage', funcCall('percentage', [operation('/', dimension(10, 'px'), dimension(50))]))
      ])
    ]);

    expect(serialize(document, { evaluator, modes: { unitMode: 'preserve', mathMode: 'always' } }).css).toBe('.math {\n'
      + '  rounded: 11;\n'
      + '  percentage: 20%;\n'
      + '}\n');
  });

  it('keeps parentheses as math context while materializing typed function arguments', () => {
    const document = stylesheet([
      rule('.math', [
        decl('rounded', funcCall('round', [
          block(operation('/', dimension(32), dimension(3)))
        ])),
        decl('unitless', funcCall('unit', [
          block(operation('/', operation('*', dimension(4, 'px'), dimension(4, 'em')), dimension(2, 'cm')))
        ]))
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.math {\n'
      + '  rounded: 11;\n'
      + '  unitless: 8;\n'
      + '}\n');
  });

  /*
   * A parenthesized operand is a MATH FRAME and nothing else: parenthesizing a
   * sub-expression must not change the answer. It used to, whenever the inner
   * PRESERVED — the paren was consumed as the frame while the outer
   * multiplication was never performed, and the whole operation came back as
   * raw source with the outer paren gone (`(100% * 100%) * 2`). The two spellings
   * are asserted against each other rather than against a fixed string, because
   * the defect was the DIVERGENCE; whatever `preserve` answers, it owes the same
   * answer to both.
   */
  it('a parenthesized preserved sub-expression composes exactly as the unparenthesized one does', () => {
    const percentSquared = () => operation('*', dimension(100, '%'), dimension(100, '%'));
    const document = stylesheet([
      rule('.math', [
        decl('parenthesized', operation('*', block(percentSquared()), dimension(2))),
        decl('bare', operation('*', percentSquared(), dimension(2)))
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.math {\n'
      + '  parenthesized: calc(100% * 100% * 2);\n'
      + '  bare: calc(100% * 100% * 2);\n'
      + '}\n');
  });

  it('unquotes an escaped Less string before typed calc arithmetic', () => {
    const document = stylesheet([
      rule('.math', [
        decl('width', funcCall('calc', [operation('-', quoted('~\'100%\'', '100%', '\'', true), dimension(3))]))
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.math {\n  width: calc(100% - 3);\n}\n');
  });
});
