import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { jessFunctions } from '@jesscss/plugin-scss';
import { Compiler } from '../../src/index.js';

/**
 * Sass's `selector.simple-selectors()` (`sass:selector`) and the global
 * `simple-selectors()`: the simple selectors of one compound selector, as a comma
 * list of unquoted strings, read from the compound's parsed tokens.
 *
 * Every expectation is Dart Sass 1.101.7's output for the same call (the `sass`
 * devDependency), and every error message is Dart Sass's.
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler().renderString(source, { extension });

const value = (call: string): string => `@use "sass:selector"; .r { v: ${call}; }`;
const css = (selector: string): string => `.r {\n  v: ${selector};\n}\n`;

const cases: ReadonlyArray<readonly [string, string]> = [
  ['".a.b:hover"', '.a, .b, :hover'],
  ['"a.b#c[d]::before"', 'a, .b, #c, [d], ::before'],
  ['".a"', '.a'],
  ['":not(.a, .b).c"', ':not(.a, .b), .c'],
  ['"*|a.b"', '*|a, .b'],
  ['"x|*:is(.a .b)"', 'x|*, :is(.a .b)'],
  ['\'[a="b c"].d\'', '[a="b c"], .d'],
  ['":nth-child(2n+1 of .a, .b)"', ':nth-child(2n+1 of .a, .b)'],
  ['selector.parse(".a:hover")', '.a, :hover']
];

describe('scss: `selector.simple-selectors()` reads a compound selector', () => {
  it.each(cases)('selector.simple-selectors(%s)', async (arg, expected) => {
    await expect(render(value(`selector.simple-selectors(${arg})`))).resolves.toBe(css(expected));
  });

  it.each(cases)('simple-selectors(%s)', async (arg, expected) => {
    await expect(render(value(`simple-selectors(${arg})`))).resolves.toBe(css(expected));
  });

  it('reads the parent selector', async () => {
    await expect(render('@use "sass:selector"; .a.b { v: selector.simple-selectors(&); }')).resolves.toBe('.a.b {\n  v: .a, .b;\n}\n');
  });

  it('gives a comma list of strings', async () => {
    await expect(render('@use "sass:selector"; @use "sass:list"; $s: selector.simple-selectors("a.b:not(.c, .d)::before"); .r { n: list.length($s); t: type-of(list.nth($s, 2)); third: list.nth($s, 3); sep: list.separator($s); }'))
      .resolves.toBe('.r {\n  n: 4;\n  t: string;\n  third: :not(.c, .d);\n  sep: comma;\n}\n');
  });
});

/* Dart Sass stops the compile with these messages; a namespaced call that cannot compute fails the compile (ruling J1). */
const errors: ReadonlyArray<readonly [string, string]> = [
  ['".a .b"', '$selector: expected selector.'],
  ['".a, .b"', '$selector: expected selector.'],
  ['"> .a"', '$selector: Expected identifier.'],
  ['"&.a"', '$selector: Parent selectors aren\'t allowed here.'],
  ['".a &"', '$selector: expected selector.'],
  ['".a, &.b"', '$selector: expected selector.'],
  ['1', '$selector: 1 is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.'],
  ['".a", ".b"', 'Only 1 argument allowed, but 2 were passed.']
];

describe('scss: `selector.simple-selectors()` errors', () => {
  it.each(errors)('selector.simple-selectors(%s) fails the compile', async (arg, message) => {
    await expect(render(value(`selector.simple-selectors(${arg})`))).rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });
});

/* `.scss → .jess → .css` is `.scss → .css`. */
describe('scss → jess: `selector.simple-selectors()`', () => {
  const functions = jessFunctions();

  it.each([
    value('selector.simple-selectors(".a.b:hover")'),
    value('simple-selectors(":not(.a, .b).c")'),
    '@use "sass:selector"; .a.b { v: selector.simple-selectors(&); }'
  ])('%s', async (source) => {
    await expect(render(emitJess(parseScss(source), { functions }), '.jess')).resolves.toBe(await render(source));
  });
});
