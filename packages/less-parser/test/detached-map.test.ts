import { Parser } from '../src/index.js';

const parser = new Parser();
const parse = parser.parse;

describe('detached ruleset map with numeric keys (Bootstrap @grays)', () => {
  it('parses a var-assigned block with numeric declaration keys', () => {
    const src = '@grays: {\n  100: @gray-100;\n  200: @gray-200;\n};';
    const { errors } = parse(src, 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
  });

  it('parses a numeric-key declaration inside a detached block', () => {
    const { errors } = parse('@m: { 1: a; };', 'Stylesheet');
    expect(errors.map(e => e.message)).toEqual([]);
  });
});
