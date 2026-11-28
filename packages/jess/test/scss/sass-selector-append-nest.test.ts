import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseScss } from '@jesscss/scss-parser';
import { jessFunctions } from '@jesscss/plugin-scss';
import { Compiler } from '../../src/index.js';

/**
 * Sass's `selector.append()` and `selector.nest()` (`sass:selector`) and their
 * global spellings `selector-append()` and `selector-nest()`. Each argument is read
 * as the selectors it holds and composed from its parsed compounds, as `&` is
 * (ledger P50, owner 2026-10-19: "in .scss, in these cases, i think do what sass
 * does"); the result is the selector value `selector.parse()` gives.
 *
 * Every expectation is Dart Sass 1.101.7's output for the same call (the `sass`
 * devDependency), and every error message is Dart Sass's; a rule whose own header
 * is a selector list is written one branch per line (ledger O8).
 */
const render = async (source: string, extension: '.scss' | '.jess' = '.scss'): Promise<string> =>
  new Compiler().renderString(source, { extension });

const value = (call: string): string => `@use "sass:selector"; .r { v: ${call}; }`;
const css = (selector: string): string => `.r {\n  v: ${selector};\n}\n`;

const append: ReadonlyArray<readonly [string, string]> = [
  ['".a-", "b, c"', '.a-b, .a-c'],
  ['".a, .b", ".x, .y"', '.a.x, .a.y, .b.x, .b.y'],
  ['".a", "-b", "-c"', '.a-b-c'],
  ['".a", "b c"', '.ab c'],
  ['".a", ".b"', '.a.b'],
  ['".a"', '.a'],
  ['".a:hover", "-x"', '.a:hover-x'],
  ['"a", "b"', 'ab'],
  ['"#x", "y"', '#xy'],
  ['"::before", "x"', '::beforex'],
  ['"x|a", "b"', 'x|ab'],
  ['".a", "b:hover .c"', '.ab:hover .c'],
  ['".a .b", "c d"', '.a .bc d'],
  ['".a .b, .c", "-x"', '.a .b-x, .c-x'],
  ['".a", ".b > c, d"', '.a.b > c, .ad'],
  ['".a", "b, :c"', '.ab, .a:c'],
  ['"[x]", ".y"', '[x].y'],
  ['":is(.a)", ":hover"', ':is(.a):hover'],
  ['".a", ":is(ns|b)"', '.a:is(ns|b)'],
  ['".a", ":not([x|y])"', '.a:not([x|y])'],
  ['".a", "[x|y]"', '.a[x|y]'],
  ['(".a", ".b"), ".c"', '.a.c, .b.c']
];

const nest: ReadonlyArray<readonly [string, string]> = [
  ['".a", ".b"', '.a .b'],
  ['".a", ".b", ".c"', '.a .b .c'],
  ['".a, .b", ".x, .y"', '.a .x, .a .y, .b .x, .b .y'],
  ['".a"', '.a'],
  ['".a", "> .b"', '.a > .b'],
  ['"> .a", ".c &"', '.c > .a'],
  ['".a", "&:hover"', '.a:hover'],
  ['".a, .b", "&-x"', '.a-x, .b-x'],
  ['".a", "&b"', '.ab'],
  ['".a.b", "&-x"', '.a.b-x'],
  ['".a .b, .c", "&-d"', '.a .b-d, .c-d'],
  ['"x|a", "&-b"', 'x|a-b'],
  ['":hover", "&-x"', ':hover-x'],
  ['".a", "&::before"', '.a::before'],
  ['".a", ".b &"', '.b .a'],
  ['".a .b", ".c &.d"', '.c .a .b.d'],
  ['".a", "& + &"', '.a + .a'],
  ['".a", "&-x &-y"', '.a-x .a-y'],
  ['".a, .b", "& &"', '.a .a, .a .b, .b .a, .b .b'],
  ['".a, .b", "&:hover .x &"', '.a:hover .x .a, .a:hover .x .b, .b:hover .x .a, .b:hover .x .b'],
  ['".a, .b", ".x &, .y"', '.x .a, .a .y, .x .b, .b .y'],
  ['".a, .b", "& &, .y"', '.a .a, .a .y, .a .b, .b .y, .b .a, .b .b'],
  ['".a", "&", "&-c"', '.a-c'],
  ['".a", "&.b", ".c &"', '.c .a.b'],
  ['".a, .b", ":not(&)"', ':not(.a, .b)'],
  ['".a", ":is(&, .z)"', ':is(.a, .z)'],
  ['".a, .b", ":not(.c &)"', ':not(.c .a, .c .b)'],
  ['".a, .b", ":nth-child(2n of &)"', ':nth-child(2n of .a, .b)'],
  ['".a", ":not(&-x)"', ':not(.a-x)'],
  ['".a, .b", ":not(&) &"', ':not(.a, .b) .a, :not(.a, .b) .b'],
  ['".a", ":is(&):hover &-x"', ':is(.a):hover .a-x'],
  ['".a", (".b", ".c")', '.a .b, .a .c']
];

describe('scss: `selector.append()` appends selectors to the ones before them', () => {
  it.each(append)('selector.append(%s)', async (args, expected) => {
    await expect(render(value(`selector.append(${args})`))).resolves.toBe(css(expected));
  });

  it.each(append)('selector-append(%s)', async (args, expected) => {
    await expect(render(value(`selector-append(${args})`))).resolves.toBe(css(expected));
  });
});

describe('scss: `selector.nest()` nests selectors in the ones before them', () => {
  it.each(nest)('selector.nest(%s)', async (args, expected) => {
    await expect(render(value(`selector.nest(${args})`))).resolves.toBe(css(expected));
  });

  it.each(nest)('selector-nest(%s)', async (args, expected) => {
    await expect(render(value(`selector-nest(${args})`))).resolves.toBe(css(expected));
  });

  it('nests in the parent selector, read as a value', async () => {
    await expect(render('@use "sass:selector"; .p, .q { v: selector.nest(&, ".x &"); }'))
      .resolves.toBe('.p,\n.q {\n  v: .x .p, .x .q;\n}\n');
  });

  it('gives the list the list functions read', async () => {
    await expect(render('@use "sass:selector"; @use "sass:list"; $s: selector.nest(".a, .b", "& > .c"); .r { n: list.length($s); second: list.nth($s, 2); compound: list.nth(list.nth($s, 2), 3); }'))
      .resolves.toBe('.r {\n  n: 2;\n  second: .b > .c;\n  compound: .c;\n}\n');
  });

  /* A name that ends with an escaped character still ends with a name (`.a\\*` is the class `a*`). */
  it.each([
    ['.a\\)', 'selector.nest(&, "&-x")', '.a\\)-x'],
    ['.a\\*', 'selector.nest(&, "&-x")', '.a\\*-x'],
    ['.a\\]', 'selector.nest(&, "&-x")', '.a\\]-x'],
    ['.b\\|c', 'selector.append(".a", &)', '.a.b\\|c']
  ])('reads the escape ending %s', async (rule, call, expected) => {
    await expect(render(`@use "sass:selector"; ${rule} { v: ${call}; }`)).resolves.toBe(`${rule} {\n  v: ${expected};\n}\n`);
  });

  /*
   * TODO(jesscss/jess#720): `&` read as a value is composed by `parentSelectorBranches`
   * (`packages/core/src/ast/serialize.ts`) over text, not by this composition, and differs
   * from Dart Sass where a selector pseudo's argument holds `&` (DESIGN-DECISIONS-NOTES § P50,
   * 2026-11-27). Both should be one composition.
   */
  it.fails('reads `&` in a pseudo argument as the parent selector, as `selector.nest()` does', async () => {
    await expect(render('@use "sass:selector"; .a, .b { :not(&) { v: &; n: selector.nest(".a, .b", ":not(&)"); } }'))
      .resolves.toContain('v: :not(.a, .b);\n    n: :not(.a, .b);');
  });

  it('writes a whole interpolated selector one branch per selector', async () => {
    await expect(render('@use "sass:selector"; #{selector.nest(".a, .b", "&-x")} { color: red; }'))
      .resolves.toBe('.a-x,\n.b-x {\n  color: red;\n}\n');
  });
});

/*
 * Dart Sass stops the compile with these messages. A function that cannot compute
 * fails the compile with its reason (ruling J1).
 */
const errors: ReadonlyArray<readonly [string, string]> = [
  ['selector.append()', '$selectors: At least one selector must be passed.'],
  ['selector.append(".a", "*")', 'Can\'t append * to .a.'],
  ['selector.append(".a, .b", "*")', 'Can\'t append * to .a, .b.'],
  ['selector.append(".a", "b c, *")', 'Can\'t append * to .a.'],
  ['selector.append(".a", "> b")', 'Can\'t append > b to .a.'],
  ['selector.append(".a", "|b")', 'Can\'t append |b to .a.'],
  ['selector.append(".a", "ns|b")', 'Can\'t append ns|b to .a.'],
  ['selector.append(".a", "*|b")', 'Can\'t append *|b to .a.'],
  ['selector.append("[x]", "y")', 'Selector "[x]" can\'t have a suffix'],
  ['selector.append(":is(.a)", "-x")', 'Selector ":is(.a)" can\'t have a suffix'],
  ['selector.append(".a", "&.b")', 'Parent selectors aren\'t allowed here.'],
  ['selector.append("&", "b")', 'Parent selectors aren\'t allowed here.'],
  ['selector.append("a", "1")', 'expected selector.'],
  ['selector.append(".a", 1)', '1 is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.'],
  ['selector.append(".a", null)', 'null is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.'],
  ['selector.nest()', '$selectors: At least one selector must be passed.'],
  ['selector.nest("[x]", "&-y")', 'Selector "[x]" can\'t have a suffix'],
  ['selector.nest(".a [x]", "&-y")', 'Selector "[x]" can\'t have a suffix'],
  ['selector.nest(".a :not(.b)", "&-x")', 'Selector ":not(.b)" can\'t have a suffix'],
  ['selector.nest("*", "&-x")', 'Selector "*" can\'t have a suffix'],
  ['selector.nest("ns|*", "&-x")', 'Selector "ns|*" can\'t have a suffix'],
  ['selector.nest(".a", "b&")', '"&" may only used at the beginning of a compound selector.'],
  ['selector.nest(".a", "&&")', '"&" may only used at the beginning of a compound selector.'],
  ['selector.nest(".a", 1)', '1 is not a valid selector: it must be a string, a list of strings, or a list of lists of strings.']
];

describe('scss: `selector.append()` / `selector.nest()` errors', () => {
  it.each(errors)('%s fails the compile', async (call, message) => {
    await expect(render(value(call))).rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });

  /*
   * A bare global that cannot compute is written out as authored by default (owner
   * 2026-10-16: "if a function as-is cannot compute, the default in Less v5 is to
   * preserve … just like Sass"), and fails the compile with Dart Sass's message under
   * `functionMode: 'error'`.
   */
  it.each([
    ['selector-append(".a", "&.b")', 'Parent selectors aren\'t allowed here.'],
    ['selector-nest("[x]", "&-y")', 'Selector "[x]" can\'t have a suffix']
  ])('%s is written as authored, and fails under functionMode: error', async (call, message) => {
    await expect(render(`.r { v: ${call}; }`)).resolves.toBe(css(call));
    await expect(new Compiler({ compile: { functionMode: 'error' } }).renderString(`.r { v: ${call}; }`, { extension: '.scss' }))
      .rejects.toMatchObject({ reason: expect.stringContaining(message) });
  });
});

/* `.scss → .jess → .css` is `.scss → .css`: each call lowers to the same function through its `.jess` module namespace or `#sass` global. */
describe('scss → jess: `selector.append()` / `selector.nest()`', () => {
  const functions = jessFunctions();
  const sources = [
    value('selector.append(".a, .b", ".x, .y")'),
    value('selector-append(".a", "-b")'),
    value('selector.nest(".a, .b", ":not(&) &")'),
    value('selector-nest(".a", "> .b", "&-c")'),
    '@use "sass:selector"; .p, .q { v: selector.nest(&, ".x &"); }'
  ];

  it.each(sources)('%s', async (source) => {
    await expect(render(emitJess(parseScss(source), { functions }), '.jess')).resolves.toBe(await render(source));
  });
});
