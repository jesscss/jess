import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * Sass's `selector.parse()` (`sass:selector`) and the global `selector-parse()`
 * read a selector string into the value `&` is (ledger P50, owner 2026-10-19:
 * "in .scss, in these cases, i think do what sass does"): a comma list of space
 * lists of compound selectors and combinators.
 *
 * Every expectation is Dart Sass 1.101.7's output (`sass --no-source-map`, the
 * `sass` devDependency), with the blank line Dart Sass writes between top-level
 * rules dropped; a rule whose own header is a selector list is written one branch
 * per line (ledger O8).
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension });

const cases: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a parsed literal passed to a mixin that writes it as a selector',
    '@use "sass:selector"; @mixin on($selector) { #{$selector} { @content; } } @include on(selector.parse(".main aside:hover, .sidebar p")) { color: red; }',
    '.main aside:hover, .sidebar p {\n  color: red;\n}\n'
  ],
  [
    'a string held in a variable',
    '@use "sass:selector"; $targets: ".btn, .link"; $parsed: selector.parse($targets); #{$parsed} { cursor: pointer; }',
    '.btn, .link {\n  cursor: pointer;\n}\n'
  ],
  [
    'the list the list functions read',
    '@use "sass:selector"; @use "sass:list"; $sel: selector.parse(".main aside:hover, .sidebar p"); .debug { count: list.length($sel); first: list.nth($sel, 1); compound: list.nth(list.nth($sel, 1), 2); }',
    '.debug {\n  count: 2;\n  first: .main aside:hover;\n  compound: aside:hover;\n}\n'
  ],
  [
    'written as a value',
    '@use "sass:selector"; .debug { value: selector.parse(".main aside:hover, .sidebar p"); }',
    '.debug {\n  value: .main aside:hover, .sidebar p;\n}\n'
  ],
  [
    'a namespace given with `as`',
    '@use "sass:selector" as sel; .debug { value: sel.parse(".nav > a"); }',
    '.debug {\n  value: .nav > a;\n}\n'
  ],
  [
    'the parent selector, read back',
    '@use "sass:selector"; .card, .panel { own: selector.parse(&); }',
    '.card,\n.panel {\n  own: .card, .panel;\n}\n'
  ],
  [
    'the global spelling',
    '.debug { global: selector-parse(".a,.b"); }',
    '.debug {\n  global: .a, .b;\n}\n'
  ]
];

describe('scss: `selector.parse()` reads a selector string', () => {
  it.each(cases)('%s', async (_name, source, expected) => {
    await expect(render(source)).resolves.toBe(expected);
  });

  /* Dart Sass: "Error: $selector: Parent selectors aren't allowed here." / "Error: $selector: expected selector." */
  it.each([
    ['a parent selector', '@use "sass:selector"; .r { x: selector.parse("&:hover"); }', 'Parent selectors aren\'t allowed here.'],
    ['a variable left in a plain string', '@use "sass:selector"; .r { x: selector.parse("$sel"); }', 'expected selector.']
  ])('fails the compile for %s', async (_name, source, message) => {
    await expect(render(source)).rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });
});

/*
 * `.scss → .jess → .css` is not yet `.scss → .css` here: a call through a Sass
 * module namespace (`selector.parse`, as `math.abs`) has no `.jess` spelling, and
 * the global `selector-parse()` lowers to a plain `.jess` call, which `.jess`
 * writes as it is.
 */
describe('scss → jess: `selector.parse()`', () => {
  it.fails.each(cases)('%s', async (_name, source) => {
    const jess = emitJess(parseScss(source));
    await expect(render(jess, '.jess')).resolves.toBe(await render(source));
  });
});
