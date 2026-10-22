import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseLess } from '@jesscss/less-parser';
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
 * per line (ledger O8). Intended divergence from Dart Sass: a selector list
 * interpolated into a selector is grouped, in every dialect (owner 2026-10-20: "our
 * merge rules and ampersand preservation rules we actually do at the global level to
 * improve not just SCSS but Less. That way we can say that dart-sass can suck it";
 * ledger P49, P50), so a whole interpolated header is one branch per selector where
 * Dart Sass splices the list's text on one line.
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler({ output: { collapseNesting: true } }).renderString(source, { extension });

const cases: ReadonlyArray<readonly [string, string, string]> = [
  [
    'a parsed literal passed to a mixin that writes it as a selector',
    '@use "sass:selector"; @mixin on($selector) { #{$selector} { @content; } } @include on(selector.parse(".main aside:hover, .sidebar p")) { color: red; }',
    '.main aside:hover,\n.sidebar p {\n  color: red;\n}\n'
  ],
  [
    'a string held in a variable',
    '@use "sass:selector"; $targets: ".btn, .link"; $parsed: selector.parse($targets); #{$parsed} { cursor: pointer; }',
    '.btn,\n.link {\n  cursor: pointer;\n}\n'
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

  /*
   * Dart Sass stops the compile here ("Error: $selector: Parent selectors aren't allowed
   * here." / "Error: $selector: expected selector."). A function that cannot compute is
   * written out as authored by default (owner 2026-10-16: "if a function as-is cannot
   * compute, the default in Less v5 is to preserve … just like Sass"), and fails the
   * compile, with Dart Sass's message, under `functionMode: 'error'`.
   */
  const invalid = [
    ['a parent selector', '@use "sass:selector"; .r { x: selector.parse("&:hover"); }', 'Parent selectors aren\'t allowed here.'],
    ['a variable left in a plain string', '@use "sass:selector"; .r { x: selector.parse("$sel"); }', 'expected selector.']
  ] as const;

  it.each(invalid)('writes the call as authored for %s', async (_name, source) => {
    await expect(render(source)).resolves.toBe(`.r {\n  x: ${source.slice(source.indexOf('selector.parse('), source.indexOf(');') + 1)};\n}\n`);
  });

  it.each(invalid)('fails the compile for %s under functionMode: error', async (_name, source, message) => {
    await expect(new Compiler({ compile: { functionMode: 'error' } }).renderString(source, { extension: '.scss' }))
      .rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });

  /*
   * Intended divergence from Dart Sass, which splices the list's text and reads it as
   * the selector (`.toolbar .btn, .button:hover`): a selector list interpolated into a
   * compound is one `:is()` group, as in `.less` and `.jess` (owner 2026-10-20: "That
   * way we can say that dart-sass can suck it"; ledger P49, P50).
   */
  it.each([false, true])('groups a parsed list interpolated into a selector, collapseNesting: %s', async (collapseNesting) => {
    const source = '@use "sass:selector"; $buttons: selector.parse(".btn, .button"); .toolbar #{$buttons}:hover { color: red; }';
    await expect(new Compiler({ output: { collapseNesting } }).renderString(source, { extension: '.scss' }))
      .resolves.toBe('.toolbar :is(.btn, .button):hover {\n  color: red;\n}\n');
  });

  it('groups `&` interpolated into a nested selector', async () => {
    await expect(new Compiler().renderString('.btn, .button { .toolbar #{&}:hover { color: red; } }', { extension: '.scss' }))
      .resolves.toBe('.btn,\n.button {\n  .toolbar :is(.btn, .button):hover {\n    color: red;\n  }\n}\n');
  });

  /* Text stays text (ledger O8): an unquoted string is spliced as written, its commas separating selectors. */
  it('splices a string interpolated into a selector as text', async () => {
    await expect(render('$buttons: ".btn, .button"; .toolbar #{$buttons}:hover { color: red; }'))
      .resolves.toBe('.toolbar .btn, .button:hover {\n  color: red;\n}\n');
  });
});

/*
 * `.scss → .jess → .css` is `.scss → .css`: a literal selector string lowers to the
 * `.jess` capture `selector(…)`, which is the same value (ledger P49), and any other
 * argument to the same function through its `.jess` module namespace.
 */
describe('scss → jess: `selector.parse()`', () => {
  /* The converter's fact that `selector-parse` is a Sass built-in (`#sass` exports it as `selectorParse`). */
  const functions = { from: '#sass', names: new Map([['selector-parse', 'selectorParse']]) };

  it.each(cases)('%s', async (_name, source) => {
    const jess = emitJess(parseScss(source), { functions });
    await expect(render(jess, '.jess')).resolves.toBe(await render(source));
  });

  it('lowers a literal to the selector() capture and any other argument to the module call', () => {
    expect(emitJess(parseScss('@use "sass:selector" as sel; $t: ".b"; .a { x: sel.parse(".nav > a, .b"); y: sel.parse($t); z: selector-parse(".c"); }'), { functions }))
      .toBe('@-use "#sass/selector" as sel;\n$t: ".b";\n.a {\n  x: selector(.nav > a, .b);\n  y: $sel.parse($t);\n  z: selector(.c);\n}\n');
  });

  it('leaves a Less call named selector-parse a call', () => {
    expect(emitJess(parseLess('.x { v: selector-parse(".a, .b"); }'))).toBe('.x {\n  v: selector-parse(".a, .b");\n}\n');
  });
});
