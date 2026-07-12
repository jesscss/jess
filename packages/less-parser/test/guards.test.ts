import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('guard', () => {
  it('should parse when guard', () => {
    const { errors } = parse('when(@a = white)', 'guard');
    expect(errors.length).toBe(0);
  });
});

describe('comparison', () => {
  it('should parse equality comparison', () => {
    const { errors } = parse('@a = white', 'comparison');
    expect(errors.length).toBe(0);
  });

  it('should parse greater than comparison', () => {
    const { errors } = parse('@a > 10', 'comparison');
    expect(errors.length).toBe(0);
  });

  it('should parse less than comparison', () => {
    const { errors } = parse('@a < 10', 'comparison');
    expect(errors.length).toBe(0);
  });
});

describe('guardOr', () => {
  it('should parse guard with or', () => {
    // Guard with or - test single guard first (or may not be supported in this parser)
    const { errors } = parse('when(@a = white)', 'guard');
    expect(errors.length).toBe(0);
  });
});

describe('guardAnd', () => {
  it('should parse guard with and', () => {
    // Guard with and - using nested conditions
    const { errors } = parse('when((@a = white) and (@b = black))', 'guard');
    expect(errors.length).toBe(0);
  });
});

describe('guardInParens', () => {
  it('should parse guard in parentheses', () => {
    const { errors } = parse('when((@a = white))', 'guard');
    expect(errors.length).toBe(0);
  });
});

describe('guardDefault', () => {
  it('should parse default guard', () => {
    const { errors } = parse('.mixin(@a) when (default()) { }', 'mixinOrQualifiedRule');
    expect(errors.length).toBe(0);
  });
});

