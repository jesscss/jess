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
 * `.jess` (owner 2026-10-16); `*[…]` is an error naming it. Inside a support condition
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

  it('prints its canonical selector() spelling in a plain value position', async () => {
    await expect(render('@s: selector( .a>.b ,satsuma );\n.x { v: @s; }', false)).resolves.toBe('.x {\n  v: selector(.a > .b, satsuma);\n}\n');
  });

  /*
   * What selector() cannot capture, and the removed `*[…]`, parse (P45) and are
   * then an error at their span (ledger P49).
   */
  it.each([
    ['less', '.x { a: selector(1px); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 18]],
    ['less', '.x { a: selector(@v); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 18]],
    ['less', '.x { a: selector(); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 9]],
    ['less', '@s: *[apple, satsuma];\n@{s} { c: d; }', 'parse/removed-selector-capture', [1, 5]],
    ['jess', '.x { a: selector($v); }\n.y { b: c; }', 'parse/selector-capture-argument', [1, 18]],
    ['jess', '$s: *[apple, satsuma];\n${s} { c: d; }', 'parse/removed-selector-capture', [1, 5]]
  ] as const)('parses %s `%s`, then reports its error', async (language, source, code, [line, column]) => {
    const result = await new Compiler().renderToResult({ source, filePath: `entry.${language}`, extension: `.${language}` }, { quiet: true });
    expect(result.errors.map(error => [error.code, error.phase, error.line, error.column])).toEqual([[code, 'parse', line, column]]);
  });

  /*
   * An error-severity diagnostic fails the compile (owner 2026-10-16). The
   * compiler does not yet stop on an error a parser recovered from; these flip
   * when it does (P49 NOTES).
   */
  it.fails.each([
    ['less', '.x { a: selector(1px); }'],
    ['less', '.x { a: *[.a]; }'],
    ['jess', '.x { a: selector(1px); }'],
    ['jess', '.x { a: *[.a]; }']
  ] as const)('fails the %s compile of `%s`', async (language, source) => {
    await expect(render(source, false, language)).rejects.toThrow();
  });

  it('names the replacement for a removed `*[…]`', async () => {
    const result = await new Compiler().renderToResult({ source: '@s: *[.a, .b > .c];', filePath: 'entry.less', extension: '.less' }, { quiet: true });
    expect(result.errors[0]).toMatchObject({ message: 'Selector capture is now written selector(…).', fix: 'Write selector(.a, .b > .c).' });
  });

  /* A capture in a calc() operand or a var() name is an operand like any other: written as authored, no crash. */
  it('writes a capture read as a calc() operand or a var() name as authored', async () => {
    await expect(render('.x { a: calc(selector(.a) + 1px); b: var(selector(.c)); }', false)).resolves.toBe('.x {\n  a: calc(selector(.a) + 1px);\n  b: var(selector(.c));\n}\n');
    await expect(render('.x { a: calc(selector(.a) + 1px); }', false, 'jess')).resolves.toBe('.x {\n  a: calc(selector(.a) + 1px);\n}\n');
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
