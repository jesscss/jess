import { parseCssFn } from '../src/grammar.js';


describe('quoted strings', () => {
  it('parses double-quoted string with escaped line continuation', () => {
    const input = 'a { content: "line1\\\nline2"; }';
    const { errors } = parseCssFn(input);
    expect(errors.length).toBe(0);
    expect(errors.length).toBe(0);
  });

  it('parses single-quoted string with escaped line continuation', () => {
    const input = 'a { content: \'line1\\\nline2\'; }';
    const { errors } = parseCssFn(input);
    expect(errors.length).toBe(0);
    expect(errors.length).toBe(0);
  });
});
