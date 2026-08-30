import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * End-to-end proof that an SCSS map literal reaches a function as DATA.
 *
 * `(a: 1, b: 2)` lowers at parse to the AST `Collection`; before the value-domain
 * map existed that Collection had no typed value, so it fell through to bytes and
 * was sniffed into one opaque `Keyword`. `length($m)` reported 1 and
 * `nth($m, 1)` returned the whole `{ a: 1; b: 2 }` block. dart-sass reports 2 and
 * `a 1`, because a map IS a list of its pairs.
 */
describe('SCSS map in a value position', () => {
  const render = async (src: string): Promise<string> =>
    new Compiler().renderString(src, { extension: '.scss' });

  it('reads a map as its list of pairs (matches dart-sass)', async () => {
    const css = await render('$m: (a: 1, b: 2);\nx { p: length($m); q: nth($m, 1); }');
    expect(css).toBe('x {\n  p: 2;\n  q: a 1;\n}\n');
  });

  it('reads the empty map as an empty list', async () => {
    expect(await render('$m: ();\nx { p: length($m); }')).toBe('x {\n  p: 0;\n}\n');
  });

  it('reads a single-entry map', async () => {
    const css = await render('$m: (a: 1);\nx { p: length($m); q: nth($m, 1); }');
    expect(css).toBe('x {\n  p: 1;\n  q: a 1;\n}\n');
  });

  /**
   * A map reaching an ARG position still serializes as the canonical Jess
   * collection spelling — never the Sass paren-map INPUT syntax, which the parser
   * lowers away. The typed representation must not move this. (A map as the
   * DIRECT value of a declaration stays rejected as a ruleset-on-property; that
   * is the structure role's boundary and is unchanged.)
   */
  it('keeps the canonical byte form in an arg position', async () => {
    const css = await render('$m: (a: 1, b: 2);\nx { p: unregistered-fn($m, z); }');
    expect(css).toBe('x {\n  p: unregistered-fn({ a: 1; b: 2 }, z);\n}\n');
  });
});
