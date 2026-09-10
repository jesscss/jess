/**
 * A `-`/`+` with whitespace before it and glued to a variable or paren
 * (`-@p`, `-(@p)`) is a leading SIGN on a new space-list item, exactly as
 * `1 -2` is for a glued digit — NOT subtraction. Bootstrap's negative margins
 * (`margin: -@y -@x -@y auto`) depend on this.
 *
 * Regression: the sum-operator sign policy exempted only ` -<digit>`; ` -@p`
 * fell through as subtraction, so `-@p -@p -@p auto` summed to `-3rem auto`.
 * Oracle: lessc 4.x keeps them as a space list.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const compile = async (source: string): Promise<string> => {
  const c = new Compiler({ output: { collapseNesting: true }, compile: { plugins: [lessPlugin()] } });
  return (await c.renderToResult({ source, language: 'less', extension: '.less' }, {})).css.trim();
};

describe('a whitespace-led sign on a variable is a space-list item, not subtraction', () => {
  it('four-value negative-variable margin stays a space list', async () => {
    expect(await compile('@p: 1rem;\n.a { margin: -@p -@p -@p auto; }'))
      .toBe('.a {\n  margin: -1rem -1rem -1rem auto;\n}');
  });
  it('two negated variables stay a space list', async () => {
    expect(await compile('@p: 1rem;\n.a { margin: -@p -@p; }')).toBe('.a {\n  margin: -1rem -1rem;\n}');
  });
  it('negated parens stay a space list', async () => {
    expect(await compile('@p: 1rem;\n.a { margin: -(@p) -(@p); }')).toBe('.a {\n  margin: -1rem -1rem;\n}');
  });
  it('literal negatives are unaffected', async () => {
    expect(await compile('.a { margin: -1rem -1rem -1rem auto; }')).toBe('.a {\n  margin: -1rem -1rem -1rem auto;\n}');
  });
  it('spaced subtraction still subtracts', async () => {
    expect(await compile('@p: 5rem;\n.a { x: (@p - @p); }')).toBe('.a {\n  x: 0rem;\n}');
  });
  it('mixed literal and negated variable is a space list', async () => {
    expect(await compile('@p: 2rem;\n.a { x: 1rem -@p; }')).toBe('.a {\n  x: 1rem -2rem;\n}');
  });
});
