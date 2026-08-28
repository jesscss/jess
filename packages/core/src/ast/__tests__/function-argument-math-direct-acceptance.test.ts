import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { cssBaseMathOutsideParens, block, decl, dimension, funcCall, operation, quoted, rule, stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());

describe('direct canonical function-argument math', () => {
  /*
   * `math: always` is a PARSE-time input (§12.6b): the Less grammar resolves it
   * per operation and writes the answer to `Operation.mathOutsideParens`, so a
   * hand-built document states the fact on the node rather than handing the
   * evaluator a mode. The expected bytes are unchanged — what changed is where
   * the decision is recorded.
   */
  it('evaluates division in Less function arguments when the node says math happens outside parens', () => {
    const alwaysDivides = (left: ReturnType<typeof dimension>, right: ReturnType<typeof dimension>) =>
      operation('/', left, right, false, true);
    const document = stylesheet([
      rule('.math', [
        decl('rounded', funcCall('round', [alwaysDivides(dimension(32), dimension(3))])),
        decl('percentage', funcCall('percentage', [alwaysDivides(dimension(10, 'px'), dimension(50))]))
      ])
    ]);

    expect(serialize(document, { evaluator, modes: { unitMode: 'preserve' } }).css).toBe('.math {\n'
      + '  rounded: 11;\n'
      + '  percentage: 20%;\n'
      + '}\n');
  });

  it('keeps parentheses as math context while materializing typed function arguments', () => {
    const document = stylesheet([
      rule('.math', [
        decl('rounded', funcCall('round', [
          block(operation('/', dimension(32), dimension(3), false, cssBaseMathOutsideParens('/')))
        ])),
        decl('unitless', funcCall('unit', [
          block(operation('/', operation('*', dimension(4, 'px'), dimension(4, 'em'), false, cssBaseMathOutsideParens('*')), dimension(2, 'cm'), false, cssBaseMathOutsideParens('/')))
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
    const percentSquared = () => operation('*', dimension(100, '%'), dimension(100, '%'), false, cssBaseMathOutsideParens('*'));
    const document = stylesheet([
      rule('.math', [
        decl('parenthesized', operation('*', block(percentSquared()), dimension(2), false, cssBaseMathOutsideParens('*'))),
        decl('bare', operation('*', percentSquared(), dimension(2), false, cssBaseMathOutsideParens('*')))
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
        decl('width', funcCall('calc', [
          operation('-', quoted('~\'100%\'', '100%', '\'', true), dimension(3), false,
            cssBaseMathOutsideParens('-'))
        ]))
      ])
    ]);

    expect(serialize(document, { evaluator }).css).toBe('.math {\n  width: calc(100% - 3);\n}\n');
  });
});
