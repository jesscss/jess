import { describe, expect, it } from 'vitest';
import { makeBuiltinRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { block, decl, dimension, funcCall, operation, quoted, rule, stylesheet } from '../nodes.js';
import { serialize } from '../serialize.js';

const evaluator = buildEvaluator(makeBuiltinRegistry());

describe('direct canonical function-argument math', () => {
  it('evaluates division in Less function arguments when mathMode is always', () => {
    const document = stylesheet([
      rule('.math', [
        decl('rounded', funcCall('round', [operation('/', dimension(32), dimension(3))])),
        decl('percentage', funcCall('percentage', [operation('/', dimension(10, 'px'), dimension(50))]))
      ])
    ]);

    expect(serialize(document, { evaluator, modes: { unitMode: 'preserve', mathMode: 'always' } }).css).toBe(
      '.math {\n'
      + '  rounded: 11;\n'
      + '  percentage: 20%;\n'
      + '}\n'
    );
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

    expect(serialize(document, { evaluator }).css).toBe(
      '.math {\n'
      + '  rounded: 11;\n'
      + '  unitless: 8;\n'
      + '}\n'
    );
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
