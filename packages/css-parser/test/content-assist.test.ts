import { CssParserChevrotain as CssParser } from '../src/index.js';

describe('Chevrotain syntactic content assist', () => {
  it('suggest() does not throw for an incomplete declaration', () => {
    const parser = new CssParser({ recoveryEnabled: true });
    const input = 'a { color';
    const out = parser.suggest(input, { offset: input.length, rule: 'stylesheet' });
    expect(Array.isArray(out)).toBe(true);
  });
});
