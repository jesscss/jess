import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('wrappedDeclarationList', () => {
  it('should parse wrapped declaration list', () => {
    const { errors } = parse('@var: { color: red; margin: 10px; }', 'stylesheet');
    expect(errors.length).toBe(0);
  });

  it('should parse empty wrapped declaration list', () => {
    const { errors } = parse('@var: { }', 'stylesheet');
    expect(errors.length).toBe(0);
  });
});

