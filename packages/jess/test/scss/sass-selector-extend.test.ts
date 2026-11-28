import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { jessFunctions } from '@jesscss/plugin-scss';
import { Compiler } from '../../src/index.js';

/**
 * Sass's `selector.extend()` (`sass:selector`) and the global `selector-extend()`:
 * `$selector` as `$extender { @extend $extendee; }` extends it, by the
 * stylesheet's own extend engine. Its result is what `@extend` writes for the
 * same rules, so where `@extend` grafts a match as `:is()` (ledger X3) the
 * function does too, and Dart Sass's woven selectors are not the oracle there.
 * The results X3 does not decide and the error messages tested here are Dart
 * Sass 1.101.7's.
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler().renderString(source, { extension });

const value = (call: string): string => `@use "sass:selector"; .r { v: ${call}; }`;
const css = (selector: string): string => `.r {\n  v: ${selector};\n}\n`;

/* [selector, extendee, extender, result]: the result is Dart Sass's as well. */
const cases: ReadonlyArray<readonly [string, string, string, string]> = [
  ['a.b', '.b', '.c:hover', 'a.b, a.c:hover'],
  ['.a', '.b', '.c', '.a'],
  ['.a.b', '.a.b', '.c', '.a.b, .c'],
  ['a', 'b', 'c', 'a'],
  ['.a', '.a', '.b, .c', '.a, .b, .c'],
  ['.a', '.a', '.a', '.a'],
  ['.a', '.a', '.b .c', '.a, .b .c'],
  ['div.a', '.a', 'span', 'div.a'],
  ['.a', '.a', '> .c', '.a, > .c']
];

/*
 * [selector, extendee, extender, result, Dart Sass's result]: where `@extend` in
 * this compiler writes a match within a compound as an `:is()` graft (X3), or
 * does not reach into `:not()`, the function writes the same.
 */
const extendDivergences: ReadonlyArray<readonly [string, string, string, string, string]> = [
  ['.a .b', '.b', '.c .d', '.a .b, .a :is(.c .d)', '.a .b, .a .c .d, .c .a .d'],
  ['.a.b', '.a', '.c', ':is(.a, .c).b', '.a.b, .b.c'],
  ['.a > .b', '.b', '.x + .y', '.a > .b, .a > :is(.x + .y)', '.a > .b, .a > .x + .y'],
  ['.a .a', '.a', '.b', ':is(.a, .b) :is(.a, .b)', '.a .a, .b .a, .a .b, .b .b'],
  ['.a:hover', '.a', '.b', ':is(.a, .b):hover', '.a:hover, .b:hover'],
  ['.a:not(.b)', '.b', '.c', '.a:not(.b)', '.a:not(.b):not(.c)'],
  ['.a, .b', '.a, .b', '.c', '.a, .b, .c', '.a, .c, .b']
];

const call = (fn: string, [selector, extendee, extender]: readonly string[]): string => `${fn}("${selector}", "${extendee}", "${extender}")`;

describe('scss: `selector.extend()` extends a selector as `@extend` does', () => {
  it.each(cases)('selector.extend("%s", "%s", "%s")', async (...args) => {
    await expect(render(value(call('selector.extend', args)))).resolves.toBe(css(args[3]));
  });

  it.each(cases)('selector-extend("%s", "%s", "%s")', async (...args) => {
    await expect(render(value(call('selector-extend', args)))).resolves.toBe(css(args[3]));
  });

  it.each(extendDivergences)('selector.extend("%s", "%s", "%s") is %s (Dart Sass: %s)', async (...args) => {
    await expect(render(value(call('selector.extend', args)))).resolves.toBe(css(args[3]));
    await expect(render(value(call('selector-extend', args)))).resolves.toBe(css(args[3]));
  });

  it.each(extendDivergences)('selector.extend("%s", "%s", "%s") is the header `@extend` writes', async (selector, extendee, extender, result) => {
    const header = (await render(`${selector} { x: 1; } ${extender} { @extend ${extendee}; }`)).replace(/,\n/g, ', ');
    expect(header).toBe(`${result} {\n  x: 1;\n}\n`);
  });

  it('binds named arguments by name', async () => {
    await expect(render(value('selector.extend(".a", $extender: ".b", $extendee: ".a")'))).resolves.toBe(css('.a, .b'));
    await expect(render(value('selector-extend($extendee: ".b", $selector: "a.b", $extender: ".c:hover")'))).resolves.toBe(css('a.b, a.c:hover'));
  });

  /* The header writes `.b::after::before` as a rule of its own; a list value has no rule to give it (Dart Sass drops it too). */
  it('leaves out a branch whose pseudo-element is followed by more', async () => {
    await expect(render(value('selector.extend(".a::before", ".a", ".b::after")'))).resolves.toBe(css('.a::before'));
  });

  it('takes the parent selector and `selector.parse()` values', async () => {
    await expect(render('@use "sass:selector"; .a.b { v: selector.extend(&, selector.parse(".a"), ".c"); }'))
      .resolves.toBe('.a.b {\n  v: :is(.a, .c).b;\n}\n');
  });

  it('gives a selector value', async () => {
    await expect(render('@use "sass:selector"; @use "sass:list"; $s: selector.extend(".a", ".a", ".b > .c"); .r { n: list.length($s); second: list.nth($s, 2); parts: list.length(list.nth($s, 2)); sep: list.separator($s); }'))
      .resolves.toBe('.r {\n  n: 2;\n  second: .b > .c;\n  parts: 3;\n  sep: comma;\n}\n');
  });
});

/* Dart Sass stops the compile with these messages; a namespaced call that cannot compute fails the compile (ruling J1). */
const errors: ReadonlyArray<readonly [string, string]> = [
  ['".a .b", ".a .b", ".c"', 'Can\'t extend complex selector .a .b.'],
  ['".a", "+ .a", ".b"', 'Can\'t extend complex selector + .a.'],
  ['".a", "&", ".c"', '$extendee: Parent selectors aren\'t allowed here.'],
  ['"&", ".a", ".c"', '$selector: Parent selectors aren\'t allowed here.'],
  ['".a", ".a", "&"', '$extender: Parent selectors aren\'t allowed here.'],
  ['".a"', 'Missing argument $extendee.'],
  ['".a", ".a"', 'Missing argument $extender.'],
  ['".a", ".a", ".b", ".c"', 'Only 3 arguments allowed, but 4 were passed.'],
  ['1, ".a", ".b"', '$selector: 1 is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.'],
  ['".a", 1, ".b"', '$extendee: 1 is not a valid selector'],
  ['".a", ".a", 1', '$extender: 1 is not a valid selector'],
  ['".a", "", ".b"', '$extendee: expected selector.']
];

describe('scss: `selector.extend()` errors', () => {
  it.each(errors)('selector.extend(%s) fails the compile', async (args, message) => {
    await expect(render(value(`selector.extend(${args})`))).rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });

  it('a bare `selector-extend()` that cannot compute is written as authored', async () => {
    await expect(render('.r { v: selector-extend(".a .b", ".a .b", ".c"); }')).resolves.toBe('.r {\n  v: selector-extend(".a .b", ".a .b", ".c");\n}\n');
  });
});

/* `.scss → .jess → .css` is `.scss → .css`. */
describe('scss → jess: `selector.extend()`', () => {
  const functions = jessFunctions();

  it.each([
    value('selector.extend(".a.b", ".a", ".c")'),
    value('selector-extend("a.b", ".b", ".c:hover")'),
    '@use "sass:selector"; .a.b { v: selector.extend(&, ".a", ".c"); }'
  ])('%s', async (source) => {
    await expect(render(emitJess(parseScss(source), { functions }), '.jess')).resolves.toBe(await render(source));
  });
});
