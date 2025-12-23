import { Parser } from '../src';

const parser = new Parser();
const parse = parser.parse;

describe('mathValue', () => {
  it('should parse at-keyword in calc', () => {
    const { errors } = parse('width: calc(@var)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse number in calc', () => {
    const { errors } = parse('width: calc(10)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse dimension in calc', () => {
    const { errors } = parse('width: calc(10px)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse identifier in calc', () => {
    const { errors } = parse('width: calc(l)', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse function call in calc', () => {
    const { errors } = parse('width: calc(func())', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse escaped string in calc', () => {
    const { errors } = parse('width: calc(~"value")', 'declaration');
    expect(errors.length).toBe(0);
  });
});

