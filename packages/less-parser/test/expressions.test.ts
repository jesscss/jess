import { Parser, type LessParserConfig } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

const parser = new Parser();
const parse = parser.parse;

describe('expressionSum', () => {
  it('should parse addition', () => {
    const { errors } = parse('width: 10px + 5px', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse subtraction', () => {
    const { errors } = parse('width: 10px - 5px', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse signed literal', () => {
    const { errors } = parse('width: -10px', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('expressionProduct', () => {
  it('should parse multiplication', () => {
    const { errors } = parse('width: 10px * 2', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse division', () => {
    const { errors } = parse('width: 20px / 2', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('keeps keyword slash values as slash lists in always math mode', () => {
    const alwaysParser = new Parser({ mathMode: 'always' } satisfies LessParserConfig);
    const { errors, tree } = alwaysParser.parse('width: foo / 2', 'declaration');

    expect(errors.length).toBe(0);
    expect(serializeTypes(tree, { showOptions: true })).toContainString(`
      value:
        (List
            sep: '/'
          [
            (Any [role=ident]
                role: 'ident'
              'foo'
            )
            (Num 2)
          ]
        )
      `);
  });

  it('should parse modulo', () => {
    const { errors } = parse('width: 10px % 3', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('expressionValue', () => {
  it('should parse parenthesized expression', () => {
    const { errors } = parse('width: (10px + 5px)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse escaped parenthesized expression', () => {
    const { errors } = parse('width: ~(10px + 5px)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse negative expression', () => {
    const { errors } = parse('width: -10px', 'declaration');
    expect(errors.length).toBe(0);
  });
});
