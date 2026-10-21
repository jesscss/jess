/**
 * Selector captures are selector VALUES, not an instruction to flatten a
 * nested rule. The output option owns that boundary: nested output preserves
 * the authored parent/child structure, while an explicit collapse references
 * every captured parent branch from the `&`. A selector glued before `&` is a
 * class of its own, never a name prefix (owner 2026-10-09: "how do you know
 * it's a prefix? that's why we can't do that"). Less `each()` is the
 * existing opt-in when the author wants one emitted rule per ordinary list item
 * without changing the document's nesting policy.
 */
import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseLess } from '@jesscss/less-parser';
import { parse as parseJess } from '@jesscss/jess-parser';
import { Compiler } from '../../src/index.js';

const captured = [
  '@fruits: selector(apple, satsuma);',
  '@{fruits} {',
  '  .fruit-& { content: "Capture"; }',
  '}'
].join('\n');

async function render(source: string, collapseNesting: boolean, language: 'less' | 'jess' | 'css' | 'scss' = 'less'): Promise<string> {
  return new Compiler({ output: { collapseNesting } }).renderString(source, {
    language,
    filePath: `/virtual/selector-capture-output.${language}`
  });
}

describe('Less selector-capture output boundaries', () => {
  it('does not implicitly flatten a captured parent list in nested output', async () => {
    await expect(render(captured, false)).resolves.toBe([
      'apple,',
      'satsuma {',
      '  .fruit-& {',
      '    content: "Capture";',
      '  }',
      '}',
      ''
    ].join('\n'));
  });

  it('references every captured branch from a `&` glued after `.fruit-` when explicitly collapsed', async () => {
    await expect(render(captured, true)).resolves.toBe([
      'apple.fruit-,',
      'satsuma.fruit- {',
      '  content: "Capture";',
      '}',
      ''
    ].join('\n'));
  });

  /* Ledger O8(b), jess#347: an escaped selector's leading whitespace is canonicalized away at the header. */
  it('drops the leading whitespace an escaped selector brings to a nested header', async () => {
    const source = [
      '@c-quoted: ~\'.a, .b\';',
      '@d-quoted: ~\'.c, .d\';',
      '@e-quoted: ~\' + .e-quoted\';',
      '@{c-quoted}@{d-quoted} {',
      '  @{e-quoted} {',
      '    foo: baz;',
      '  }',
      '}'
    ].join('\n');

    await expect(render(source, false)).resolves.toBe([
      '.a, .b.c, .d {',
      '  + .e-quoted {',
      '    foo: baz;',
      '  }',
      '}',
      ''
    ].join('\n'));
    await expect(render(source, true)).resolves.toBe([
      '.a, .b.c, .d + .e-quoted {',
      '  foo: baz;',
      '}',
      ''
    ].join('\n'));
  });

  /*
   * Escaped text in a selector prints as written, never read as selector syntax
   * (owner 2026-10-09: "everywhere that is text should print AS WRITTEN"): its
   * commas are characters, so a nested header keeps it on one line and a
   * collapsed one glues it after its parent, never in an `:is()`. The
   * whitespace it opens with is still dropped at the header (ledger O8(b)).
   * One branch per line (O8(a)) is for a structured list (`selector(…)`).
   */
  it('prints a quoted selector text as written in a nested header', async () => {
    const source = [
      '@g: ~\' .e, .f\';',
      '.a {',
      '  @{g} {',
      '    foo: baz;',
      '  }',
      '}'
    ].join('\n');

    await expect(render(source, false)).resolves.toBe([
      '.a {',
      '  .e, .f {',
      '    foo: baz;',
      '  }',
      '}',
      ''
    ].join('\n'));
    await expect(render(source, true)).resolves.toBe([
      '.a .e, .f {',
      '  foo: baz;',
      '}',
      ''
    ].join('\n'));
    await expect(render('@g: ~\' .e, .f\';\n@{g} { foo: baz; }', false)).resolves.toBe('.e, .f {\n  foo: baz;\n}\n');
  });

  it('uses Less each() for explicit rule multiplication without enabling global collapse', async () => {
    const source = [
      '@fruits: apple, satsuma;',
      'each(@fruits, .(@fruit) {',
      '  .fruit-@{fruit} { content: "Capture"; }',
      '});'
    ].join('\n');

    await expect(render(source, false)).resolves.toBe([
      '.fruit-apple {',
      '  content: "Capture";',
      '}',
      '.fruit-satsuma {',
      '  content: "Capture";',
      '}',
      ''
    ].join('\n'));
  });
});

/*
 * `selector(<selector-list>)` is the selector-capture spelling in `.less` and
 * `.jess` (owner 2026-10-16). Inside a support condition
 * `selector()` stays CSS's feature test, and `.css` / `.scss` keep value-position
 * `selector()` an ordinary function call.
 */
describe('selector() capture', () => {
  const complex = '.a > .b ~ .c + .d, input[type=text], a:hover';

  it('expands every captured branch in a nested and in a collapsed header, in .less and .jess', async () => {
    const less = `@s: selector(${complex});\n.p { @{s} { c: d; } }`;
    const jess = `$s: selector(${complex});\n.p { \${s} { c: d; } }`;
    const nested = '.p {\n  .a > .b ~ .c + .d,\n  input[type=text],\n  a:hover {\n    c: d;\n  }\n}\n';
    const collapsed = '.p :is(.a > .b ~ .c + .d, input[type=text], a:hover) {\n  c: d;\n}\n';

    await expect(render(less, false)).resolves.toBe(nested);
    await expect(render(less, true)).resolves.toBe(collapsed);
    await expect(render(jess, false, 'jess')).resolves.toBe(nested);
    await expect(render(jess, true, 'jess')).resolves.toBe(collapsed);
  });

  it('keeps a `&` inside the capture a parent reference', async () => {
    await expect(render('@s: selector(&.x, & + .y);\n.p { @{s} { c: d; } }', false)).resolves.toBe(
      '.p {\n  &.x,\n  & + .y {\n    c: d;\n  }\n}\n'
    );
  });

  it('is a value a guard compares', async () => {
    await expect(render('.m() when (selector(.a) = selector(.a)) { ok: 1; }\n.x { .m(); }', false)).resolves.toBe('.x {\n  ok: 1;\n}\n');
    await expect(render('.m() when (selector(.a)) { ok: 1; }\n.x { .m(); }\n.y { z: 1; }', false)).resolves.toBe('.y {\n  z: 1;\n}\n');
  });

  /*
   * What selector() cannot capture parses (P45) and is then an error at its
   * span (ledger P49).
   */
  it.each([
    ['less', '.x { a: selector(1px); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 18]],
    ['less', '.x { a: selector(@v); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 18]],
    ['less', '.x { a: selector(); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 9]],
    ['less', '.x { a: selector(.a:is(1px)); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 24]],
    ['less', '.x { a: selector(.a:not(@{t})); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 25]],
    ['jess', '.x { a: selector($v); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 18]]
  ] as const)('parses %s `%s`, then reports its error', async (language, source, code, [line, column]) => {
    const result = await new Compiler().renderToResult({ source, filePath: `entry.${language}`, extension: `.${language}` }, { quiet: true });
    expect(result.css).toBe('');
    expect(result.errors.map(error => [error.code, error.phase, error.line, error.column])).toEqual([[code, 'parse', line, column]]);
  });

  /* An error-severity diagnostic fails the compile (owner 2026-10-16), a recovered parse error too. */
  it.each([
    ['less', '.x { a: selector(1px); }'],
    ['less', '.x { a: selector(.a:is(1px)); }'],
    ['jess', '.x { a: selector(1px); }']
  ] as const)('fails the %s compile of `%s`', async (language, source) => {
    await expect(render(source, false, language)).rejects.toThrow(/selector\(\) takes a selector list/u);
  });

  /* A selector's own punctuation is selector syntax, never value punctuation (ledger P48). */
  it.each([
    ['less', '@s: selector(.a ~ .b, .c.d, a|b, [x^=y], [x|=y]);\n.p { @{s} { c: d; } }'],
    ['jess', '$s: selector(.a ~ .b, .c.d, [x^=y]);\n.p { ${s} { c: d; } }'],
    ['less', '.x { c: if(supports(selector(.a ~ .b)): x; else: y); }'],
    ['less', '@supports selector(.a ~ .b) { .x { c: d; } }'],
    ['jess', '@supports selector(.a ~ .b) { .x { c: d; } }']
  ] as const)('reports no error for %s `%s`', async (language, source) => {
    const result = await new Compiler().renderToResult({ source, filePath: `entry.${language}`, extension: `.${language}` }, { quiet: true });
    expect(result.errors).toEqual([]);
  });

  /* A capture in a calc() operand or a var() name is an operand like any other: its value, the selector list, is written. */
  it('writes the selectors of a capture read as a calc() operand or a var() name', async () => {
    await expect(render('.x { a: calc(selector(.a) + 1px); b: var(selector(.c)); }', false)).resolves.toBe('.x {\n  a: calc(.a + 1px);\n  b: var(.c);\n}\n');
    await expect(render('.x { a: calc(selector(.a) + 1px); }', false, 'jess')).resolves.toBe('.x {\n  a: calc(.a + 1px);\n}\n');
  });

  /* A comma list of captures is the list of their branches, as one capture of them is. */
  it('expands a comma list of captures like one capture of their branches, in .less and .jess', async () => {
    const less = '@s: selector(.a), selector(.b);\n.p { @{s} { c: d; } }';
    const jess = '$s: selector(.a), selector(.b);\n.p { ${s} { c: d; } }';
    const nested = '.p {\n  .a,\n  .b {\n    c: d;\n  }\n}\n';
    const collapsed = '.p :is(.a, .b) {\n  c: d;\n}\n';

    await expect(render(less, false)).resolves.toBe(nested);
    await expect(render(less, true)).resolves.toBe(collapsed);
    await expect(render(jess, false, 'jess')).resolves.toBe(nested);
    await expect(render(jess, true, 'jess')).resolves.toBe(collapsed);
    await expect(render('@s: selector(.a), selector(.b);\n@{s} { c: d; }', false)).resolves.toBe('.a,\n.b {\n  c: d;\n}\n');
  });

  it('expands a capture passed as a mixin argument, in .less and .jess', async () => {
    const less = '.m(@s) { @{s} { c: d; } }\n.p { .m(selector(.a, .b)); }';
    const jess = '.m($s) { ${s} { c: d; } }\n.p { $ > .m(selector(.a, .b)); }';
    const nested = '.p {\n  .a,\n  .b {\n    c: d;\n  }\n}\n';
    const collapsed = '.p :is(.a, .b) {\n  c: d;\n}\n';

    await expect(render(less, false)).resolves.toBe(nested);
    await expect(render(less, true)).resolves.toBe(collapsed);
    await expect(render(jess, false, 'jess')).resolves.toBe(nested);
    await expect(render(jess, true, 'jess')).resolves.toBe(collapsed);
    await expect(render('.m(@s) { @{s} { c: d; } }\n.p { .m(selector(.a), selector(.b);); }', false)).resolves.toBe(nested);
  });

  it('expands a capture a variable passes as a mixin argument', async () => {
    await expect(render('@t: selector(.a, .b);\n.m(@s) { @{s} { c: d; } }\n.p { .m(@t); }', false)).resolves.toBe('.p {\n  .a,\n  .b {\n    c: d;\n  }\n}\n');
  });

  /*
   * A selector list interpolated into a selector is grouped by its value, however the
   * value is reached (ledger P49, P50; owner 2026-10-20: "variables aren't looser", "we
   * should be consistent about values"): a variable, an alias of it, a mixin parameter,
   * `&` and `selector.parse()` give the selector the capture written in place gives.
   */
  describe('a selector-list value is the same selector however it is reached', () => {
    const glued = '.toolbar :is(.btn, .button):hover {\n  color: red;\n}\n';

    it.each([
      ['less', 'a variable', '@buttons: selector(.btn, .button);\n.toolbar @{buttons}:hover { color: red; }'],
      ['less', 'an alias', '@buttons: selector(.btn, .button);\n@clickable: @buttons;\n.toolbar @{clickable}:hover { color: red; }'],
      ['jess', 'a variable', '$buttons: selector(.btn, .button);\n.toolbar ${buttons}:hover { color: red; }'],
      ['jess', 'an alias', '$buttons: selector(.btn, .button);\n$clickable: $buttons;\n.toolbar ${clickable}:hover { color: red; }'],
      ['jess', 'selector.parse()', '@-use "#sass/selector";\n$buttons: $selector.parse(".btn, .button");\n.toolbar ${buttons}:hover { color: red; }']
    ] as const)('%s: %s glued to a selector is one :is() group', async (language, _route, source) => {
      await expect(render(source, false, language)).resolves.toBe(glued);
    });

    it.each([false, true])('a mixin parameter, collapseNesting: %s', async (collapseNesting) => {
      const source = '@buttons: selector(.btn, .button);\n.hover(@targets) { @{targets}:hover { color: red; } }\n.toolbar { .hover(@buttons); }';
      await expect(render(source, collapseNesting)).resolves.toBe(collapseNesting
        ? glued
        : '.toolbar {\n  :is(.btn, .button):hover {\n    color: red;\n  }\n}\n');
    });

    it.each([false, true])('`&` in .jess, collapseNesting: %s', async (collapseNesting) => {
      const source = '.btn, .button {\n  $self: &;\n  .toolbar ${self}:hover { color: red; }\n}';
      await expect(render(source, collapseNesting, 'jess')).resolves.toBe(collapseNesting
        ? ':is(.btn, .button) .toolbar :is(.btn, .button):hover {\n  color: red;\n}\n'
        : '.btn,\n.button {\n  .toolbar :is(.btn, .button):hover {\n    color: red;\n  }\n}\n');
    });

    it.each([false, true])('a whole nested selector from an alias and selector.parse(), collapseNesting: %s', async (collapseNesting) => {
      const expected = collapseNesting
        ? '.toolbar :is(.btn, .button) {\n  color: red;\n}\n'
        : '.toolbar {\n  .btn,\n  .button {\n    color: red;\n  }\n}\n';
      await expect(render('@buttons: selector(.btn, .button);\n@clickable: @buttons;\n.toolbar { @{clickable} { color: red; } }', collapseNesting)).resolves.toBe(expected);
      await expect(render('@-use "#sass/selector";\n$buttons: $selector.parse(".btn, .button");\n.toolbar { ${buttons} { color: red; } }', collapseNesting, 'jess')).resolves.toBe(expected);
    });

    it('a list glued after a name prefix whose selectors open with `.` is a compound boundary: one :is() group', async () => {
      await expect(render('@buttons: selector(.btn, .button);\n.toolbar@{buttons} { color: red; }', false))
        .resolves.toBe('.toolbar:is(.btn, .button) {\n  color: red;\n}\n');
    });

    /*
     * A list glued to a name continues it, as `&__x` does: one branch per selector, never
     * `:is()`, which is no part of a name (`.col-:is(sm, md)`, `:is(.card, .panel)__title`).
     */
    describe('a list continuing a name multiplies branches', () => {
      it.each([
        ['less', '@sizes: sm, md;\n.col-@{sizes} { float: left; }'],
        ['jess', '$sizes: sm, md;\n.col-${sizes} { float: left; }']
      ] as const)('%s: a name prefix', async (language, source) => {
        await expect(render(source, false, language)).resolves.toBe('.col-sm,\n.col-md {\n  float: left;\n}\n');
      });

      it.each([false, true])('scss: #{&} before a BEM suffix under two parents, collapseNesting: %s', async (collapseNesting) => {
        await expect(render('.card, .panel {\n  #{&}__title { font-weight: bold; }\n}', collapseNesting, 'scss')).resolves.toBe(collapseNesting
          ? ':is(.card, .panel) .card__title,\n:is(.card, .panel) .panel__title {\n  font-weight: bold;\n}\n'
          : '.card,\n.panel {\n  .card__title,\n  .panel__title {\n    font-weight: bold;\n  }\n}\n');
      });

      it('scss: #{&} before a BEM suffix under one parent', async () => {
        await expect(render('.card {\n  #{&}__title { font-weight: bold; }\n}', false, 'scss'))
          .resolves.toBe('.card {\n  .card__title {\n    font-weight: bold;\n  }\n}\n');
      });
    });

    /* Escaped text is never read as selector syntax (ledger O8, owner 2026-10-09: "everywhere that is text should print AS WRITTEN"). */
    it('leaves escaped text spliced as written', async () => {
      await expect(render('@buttons: ~".btn, .button";\n@clickable: @buttons;\n.toolbar @{clickable}:hover { color: red; }', false))
        .resolves.toBe('.toolbar .btn, .button:hover {\n  color: red;\n}\n');
    });
  });

  /* Follow-up (P49 NOTES): an interpolated selector is not captured yet; today it takes the error path above. */
  it.fails('captures an interpolated selector', async () => {
    await expect(render('@x: ~".a";\n@s: selector(@{x}, .b);\n@{s} { c: d; }', false)).resolves.toBe('.a,\n.b {\n  c: d;\n}\n');
  });

  it('converts to the same selector() capture in .jess', () => {
    const less = parseLess('@fruits: selector(apple, .b > .c);');
    const jess = emitJess(less);
    expect(jess).toBe('$fruits: selector(apple, .b > .c);\n');
    expect(parseJess(jess).rules[0]).toMatchObject({
      value: { type: 'SelectorCapture', branches: ['apple', '.b > .c'], src: 'selector(apple, .b > .c)' }
    });
  });

  it('leaves @supports selector() a feature test in all four dialects', async () => {
    const source = '@supports selector(.a ~ .b) {\n  .x {\n    c: d;\n  }\n}\n';
    for (const language of ['css', 'less', 'scss', 'jess'] as const) {
      await expect(render(source, false, language), language).resolves.toBe(source);
    }
  });

  it('leaves the supports() test of a CSS if() a feature test', async () => {
    const source = '.x {\n  c: if(supports(selector(.a)): x; else: y);\n}\n';
    for (const language of ['css', 'less'] as const) {
      await expect(render(source, false, language), language).resolves.toBe(source);
    }
  });

  it('keeps value-position selector() an ordinary function call in .css and .scss', async () => {
    const source = '.x {\n  v: selector(a, b);\n}\n';
    for (const language of ['css', 'scss'] as const) {
      await expect(render(source, false, language), language).resolves.toBe(source);
    }
  });
});
