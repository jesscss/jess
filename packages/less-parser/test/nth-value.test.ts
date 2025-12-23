import { Parser } from '../src';

const parser = new Parser();
const parse = parser.parse;

describe('nthValue', () => {
  it('should parse nth-odd', () => {
    const { errors } = parse(':nth-child(odd)', 'simpleSelector');
    expect(errors.length).toBe(0);
  });

  it('should parse nth-even', () => {
    const { errors } = parse(':nth-child(even)', 'simpleSelector');
    expect(errors.length).toBe(0);
  });

  it('should parse nth with integer', () => {
    const { errors } = parse(':nth-child(3)', 'simpleSelector');
    expect(errors.length).toBe(0);
  });

  it('should parse nth with dimension', () => {
    const { errors } = parse(':nth-child(2n)', 'simpleSelector');
    expect(errors.length).toBe(0);
  });

  it('should parse nth with of selector', () => {
    const { errors } = parse(':nth-child(2n of .item)', 'simpleSelector');
    expect(errors.length).toBe(0);
  });
});

