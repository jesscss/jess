import { Parser } from '../src/index.js';

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

