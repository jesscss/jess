import { Parser } from '../src';

const parser = new Parser();
const parse = parser.parse;

describe('string', () => {
  it('should parse single-quoted string', () => {
    const { errors } = parse("content: 'text'", 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse double-quoted string', () => {
    const { errors } = parse('content: "text"', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse escaped string with ~', () => {
    const { errors } = parse("content: ~'text'", 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse string with interpolation', () => {
    const { errors } = parse('content: "@{var}"', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse empty string', () => {
    const { errors } = parse('content: ""', 'declaration');
    expect(errors.length).toBe(0);
  });
});

