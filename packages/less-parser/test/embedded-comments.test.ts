import { Parser } from '../src/jess.js';

const parser = new Parser();
const parse = parser.parse;

describe('line comments inside expressions/parens', () => {
  // Regression: a `//` line comment inside a parenthesized operation must be
  // consumed as Less trivia, not left as a value token (repro from comments2.less).
  it('skips // line comments inside a parenthesized operation', () => {
    const input = `@gridsystem-width: (@column-width *   //  For calc...
                    @columns) + (     //  width of the content area.
                    @gutter-width *   //  We ...
                    @columns);`;
    const { errors } = parse(input);
    expect(errors).toStrictEqual([]);
  });

  it('skips a // line comment immediately after the opening paren', () => {
    const { errors } = parse('@w: ( //c\n @a * @b);');
    expect(errors).toStrictEqual([]);
  });

  it('skips a // line comment between operand and operator inside a bare paren', () => {
    const { errors } = parse('width: (1 + //c\n 2)', 'declaration');
    expect(errors).toStrictEqual([]);
  });
});
