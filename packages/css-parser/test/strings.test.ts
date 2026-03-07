import { CssParser } from '../src/index.js';

const cssParser = new CssParser();

describe('quoted strings', () => {
  it('parses double-quoted string with escaped line continuation', () => {
    const input = 'a { content: "line1\\\nline2"; }';
    const { lexerResult, errors } = cssParser.parse(input);
    expect(lexerResult.errors.length).toBe(0);
    expect(errors.length).toBe(0);
  });

  it('parses single-quoted string with escaped line continuation', () => {
    const input = 'a { content: \'line1\\\nline2\'; }';
    const { lexerResult, errors } = cssParser.parse(input);
    expect(lexerResult.errors.length).toBe(0);
    expect(errors.length).toBe(0);
  });
});
