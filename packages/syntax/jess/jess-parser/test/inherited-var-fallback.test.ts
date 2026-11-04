import { expect, it } from 'vitest';
import { parse } from '@jesscss/jess-parser';

/*
 * `.jess` overrides `VarCall` with a fallback read in its own value grammar,
 * and inherits the CSS query values whose `var(` arm reads CSS's `VarCall`.
 * A leading `var()` with a fallback in a media range keeps the CSS fallback
 * there: routing that arm to the dialect's override stopped this document
 * parsing at the `+`.
 */
it('a var() fallback in an inherited media range keeps the CSS fallback', () => {
  const sheet = parse('@media (var(--x, 1px + 2px) < width) { .a { b: c; } } .z { y: w; }');
  expect(sheet.rules).toHaveLength(2);
});
