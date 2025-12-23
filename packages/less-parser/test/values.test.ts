import { Parser } from '../src';

const parser = new Parser();
const parse = parser.parse;

describe('value', () => {
  it('should parse color value', () => {
    const { errors } = parse('color: red', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse dimension value', () => {
    const { errors } = parse('width: 10px', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse number value', () => {
    const { errors } = parse('opacity: 0.5', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse string value', () => {
    const { errors } = parse('content: "text"', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse function call value', () => {
    const { errors } = parse('color: rgb(255, 0, 0)', 'declaration');
    expect(errors.length).toBe(0);
  });
});

describe('valueSequence', () => {
  it('should parse sequence of values', () => {
    const { errors } = parse('margin: 10px 20px', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse single value (not sequence)', () => {
    const { errors } = parse('color: red', 'declaration');
    expect(errors.length).toBe(0);
  });
});

