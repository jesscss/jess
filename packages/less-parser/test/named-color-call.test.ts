import { Parser } from '../src/jess.js';
import { describe, it, expect } from 'vitest';

const parser: any = new Parser();
const parse = parser.parse;

describe('named color immediately followed by ( is a function call', () => {
  it('parses red(...) as a Call, not a NamedColor + Paren', () => {
    const { errors, tree } = parse('color: red(rgb(100%, 0, 0))', 'declaration');
    expect(errors.length).toBe(0);
    const value: any = (tree as any)?.value;
    // Regression: `red(` used to split into NamedColor("red") + Paren("(rgb(...))")
    // because the NamedColor regex matched even when immediately followed by `(`.
    // A single Call node (not a two-term value sequence) is the fix.
    expect(value?.type).toBe('Call');
    expect(value?.name?.type).toBe('Reference');
    expect(value?.args?.value?.length).toBe(1);
  });

  it('still parses a bare named color as a color', () => {
    const { errors, tree } = parse('color: red', 'declaration');
    expect(errors.length).toBe(0);
    const value: any = (tree as any)?.value;
    expect(value?.type).toBe('Color');
  });
});
