import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * A `--`-led name in a selector compiles in every dialect: `--b` is an ident
 * (css-syntax-3 §4.3.9), so `.--b` and `#--b` are a class and an id (selectors-4
 * §3.2) and `:--heading` a custom selector's use (css-extensions-1
 * `<custom-selector>`). A declaration keeps its meaning beside them.
 */
const compile = (dialect: string, source: string) =>
  new Compiler({ quiet: true }).renderToResult(
    { source, filePath: `/proj/entry.${dialect}` },
    { quiet: true, suppressWarnings: true, breakOnError: false }
  );

const rule = (selector: string) => `${selector} {\n  color: red;\n}\n`;

const expectCss = async (dialect: string, source: string, css: string) => {
  const result = await compile(dialect, source);
  expect(result.errors).toEqual([]);
  expect(result.css).toBe(css);
};

describe.each(['css', 'less', 'scss', 'jess'])('.%s', (dialect) => {
  it.each([
    '.--b',
    '#--b',
    '.a.--b',
    '.a#--b',
    'a.--b',
    '.c .--b',
    '.c > .--b',
    '.--b:hover',
    '.--b::before',
    ':not(.--b)',
    ':has(> .--b)',
    'li:nth-child(2n of .--b)',
    ':--heading',
    'a:--heading',
    ':not(:--heading)'
  ])('%s', async (selector) => {
    await expectCss(dialect, `${selector} { color: red; }`, rule(selector));
  });

  it.each([':is(.--b, .c)', ':where(#--b)'])('%s is a selector, so it does not warn', async (selector) => {
    const result = await new Compiler({ quiet: true }).renderToResult(
      { source: `${selector} { color: red; }`, filePath: `/proj/entry.${dialect}` },
      { quiet: true, breakOnError: false }
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map(warning => warning.code)).not.toContain('css/forgiving-selector-item');
    expect(result.css).toBe(rule(selector));
  });

  it.each([
    [':is(.--b /*x*/)', ':is(.--b)'],
    [':is(.a /*x*/)', ':is(.a)'],
    [':where(.a /*x*/, .b /*x*/)', ':where(.a, .b)'],
    [':not(.--b /*x*/)', ':not(.--b)'],
    [':not(.a /*x*/)', ':not(.a)'],
    [':has(> .a /*x*/)', ':has(> .a)']
  ])('a comment before the close of %s is trivia', async (selector, written) => {
    await expectCss(dialect, `${selector} { color: red; }`, rule(written));
  });

  it('an `of` selector is written with single spaces', async () => {
    await expectCss(dialect, 'li:nth-child(2n   of   .--b) { color: red; }', rule('li:nth-child(2n of .--b)'));
  });

  it('a list holding one', async () => {
    await expectCss(dialect, '.c, .--b { color: red; }', rule('.c,\n.--b'));
    await expectCss(dialect, ':--heading > a, b { color: red; }', rule(':--heading > a,\nb'));
  });

  it('nested in a rule and an at-rule', async () => {
    await expectCss(dialect, '.c { .--b { color: red; } }', '.c {\n  .--b {\n    color: red;\n  }\n}\n');
    await expectCss(dialect, '.c { &.--b { color: red; } }', '.c {\n  &.--b {\n    color: red;\n  }\n}\n');
    await expectCss(dialect, '.c { :--heading { color: red; } }', '.c {\n  :--heading {\n    color: red;\n  }\n}\n');
    await expectCss(dialect, '@media (min-width: 1px) { .--b { color: red; } }', '@media (min-width: 1px) {\n  .--b {\n    color: red;\n  }\n}\n');
  });

  it('a declaration stays a declaration', async () => {
    await expectCss(dialect, '.a { --b:hover; }', '.a {\n  --b: hover;\n}\n');
    await expectCss(dialect, '.a { color:--x; }', '.a {\n  color: --x;\n}\n');
    await expectCss(dialect, '.a { b:--c }', '.a {\n  b: --c;\n}\n');
  });
});

describe.each(['css', 'less', 'jess'])('.%s', (dialect) => {
  it.each([
    [':is( /*x*/ .--b /*x*/ )', ':is(.--b)'],
    [':not( /*x*/ .a /*x*/ )', ':not(.a)']
  ])('a comment at both ends of %s is trivia', async (selector, written) => {
    await expectCss(dialect, `${selector} { color: red; }`, rule(written));
  });
});

describe('.less', () => {
  it.each([
    ['.--b() { color: red; }\n.a { .--b(); }', rule('.a')],
    ['.--b { color: red; }\n.a { .--b; }', `${rule('.--b')}${rule('.a')}`],
    ['#--b() { color: red; }\n.a { #--b(); }', rule('.a')],
    ['#ns { .--b() { color: red; } }\n.a { #ns > .--b(); }', rule('.a')]
  ])('a mixin by its name: %j', async (source, css) => {
    await expectCss('less', source, css);
  });

  it.each([
    ['.--b { color: red; }\n.c:extend(.--b) { d: e; }'],
    ['.--b { color: red; }\n.c:extend(.--b all) { d: e; }']
  ])('an extend target: %j', async (source) => {
    await expectCss('less', source, `${rule('.--b,\n.c')}.c {\n  d: e;\n}\n`);
  });

  it('an extend target in a rule', async () => {
    await expectCss('less', '.--b { color: red; }\n.c { &:extend(.--b); }', rule('.--b,\n.c'));
  });

  it('an escape in a pseudo\'s name keeps its bytes', async () => {
    await expectCss('less', '.a:\\68 over { color: red; }', rule('.a:\\68 over'));
  });

  it('an interpolated name', async () => {
    await expectCss('less', '@x: y;\n.--@{x} { color: red; }', rule('.--y'));
    await expectCss('less', '@x: y;\n#--@{x} { color: red; }', rule('#--y'));
  });
});

describe('.scss', () => {
  it.each([
    ['.a { &--m { b: c } }', '.a--m {\n  b: c;\n}\n'],
    ['.a { &--b { color: red; } }', rule('.a--b')],
    ['.a { &-- { color: red; } }', rule('.a--')],
    ['$x: y;\n.a { &--#{$x} { color: red; } }', rule('.a--y')],
    ['$x: y;\n.a { &--b#{$x} { color: red; } }', rule('.a--by')],
    ['.a { &--b.d { color: red; } }', rule('.a--b.d')],
    ['.a { &--b:hover { color: red; } }', rule('.a--b:hover')],
    ['.a { &--b &--d { color: red; } }', rule('.a--b .a--d')],
    ['.a { &:hover &--b { color: red; } }', rule('.a:hover .a--b')],
    ['.a { .f &--b { color: red; } }', rule('.f .a--b')],
    ['.a, .e { &--b { color: red; } }', rule('.a--b,\n.e--b')]
  ])('a `--` suffix on the parent: %s', async (source, css) => {
    await expectCss('scss', source, css);
  });

  it('an extend target and an extender', async () => {
    await expectCss('scss', '.--b { color: red; }\n.c { @extend .--b; }', rule('.--b,\n.c'));
    await expectCss('scss', '.d { color: red; }\n.a { &--b { @extend .d; } }', rule('.d,\n.a--b'));
  });
});
