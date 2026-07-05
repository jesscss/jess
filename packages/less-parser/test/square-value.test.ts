import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('squareValue', () => {
  it('should parse square bracket value with identifier', () => {
    const { errors } = parse('color: [key]', 'declaration');
    expect(errors.length).toBe(0);
  });

  it('should parse empty square brackets', () => {
    const { errors } = parse('color: []', 'declaration');
    expect(errors.length).toBe(0);
  });
});
