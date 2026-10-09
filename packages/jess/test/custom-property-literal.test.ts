import { describe, expect, it } from 'vitest';
import { emitJess, NoJessSpelling } from '@jesscss/core';
import { parse as parseLess } from '@jesscss/less-parser';
import { Compiler } from '../src/index.js';

/*
 * DESIGN-DECISIONS P2 (owner; reaffirmed 2026-10-09): a custom-property value
 * is CSS text. A dialect adds only its own interpolation — Less `@{…}`, SCSS
 * `#{…}`, `.jess` `${…}` — and every other byte, a bare variable included, is
 * written as authored and never looked up. `--x: @c` is valid CSS, so it is
 * written the same in every dialect (SEMANTIC-INVARIANTS 4).
 */
type Dialect = 'less' | 'scss' | 'jess';

async function render(source: string, language: Dialect): Promise<string> {
  const css = await new Compiler().renderString(source, { language, extension: `.${language}` });
  return css.replace(/\s+/g, ' ').trim();
}

describe('custom-property values are written as authored (P2)', () => {
  it('Less: a bare variable, math, a call and an escape are text; only @{…} interpolates', async () => {
    expect(await render('@c: red; .a { --x: @c; --y: calc(@c + 1px); --i: @{c}; --e: ~"a/b"; --f: percentage(0.5); --m: @{c} @c; }', 'less'))
      .toBe('.a { --x: @c; --y: calc(@c + 1px); --i: red; --e: ~"a/b"; --f: percentage(0.5); --m: red @c; }');
  });

  it('Less: an undefined variable is text, not an error, because nothing is looked up', async () => {
    expect(await render('.a { --x: @nope; --y: @@nope @nope[k] @nope(); }', 'less'))
      .toBe('.a { --x: @nope; --y: @@nope @nope[k] @nope(); }');
  });

  it('Less: a style() query value and a var() fallback read the same way', async () => {
    expect(await render('@a: 3; @container style(--x: @a) { .b { c: d; } } @container style(--x: @{a}) { .b { c: d; } }', 'less'))
      .toBe('@container style(--x: @a) { .b { c: d; } } @container style(--x: 3) { .b { c: d; } }');
    expect(await render('@a: 3; @supports (--x: @a) { .b { c: d; } } @supports (--x: @{a}) { .b { c: d; } }', 'less'))
      .toBe('@supports (--x: @a) { .b { c: d; } } @supports (--x: 3) { .b { c: d; } }');
    expect(await render('@a: 3; .b { c: var(--x, @a); d: var(--x, @{a}); }', 'less'))
      .toBe('.b { c: var(--x, @a); d: var(--x, 3); }');
  });

  it('SCSS: a bare variable is text; only #{…} interpolates', async () => {
    expect(await render('$c: red; .a { --x: $c; --y: calc($c + 1px); --i: #{$c}; --w: @c; }', 'scss'))
      .toBe('.a { --x: $c; --y: calc($c + 1px); --i: red; --w: @c; }');
  });

  it('.jess: a bare variable is text; only ${…} interpolates', async () => {
    expect(await render('$c: red; .a { --x: $c; --y: calc($c + 1px); --i: ${c}; --w: @c; --e: ~"a/b"; }', 'jess'))
      .toBe('.a { --x: $c; --y: calc($c + 1px); --i: red; --w: @c; --e: ~"a/b"; }');
  });

  it('.less → .jess → .css keeps a literal `@c` in a custom property', async () => {
    const source = '@c: red; .a { --x: @c; --y: calc(@c + 1px); --z: @nope; }';
    expect(await render(emitJess(parseLess(source)), 'jess')).toBe(await render(source, 'less'));
  });

  it('.less → .jess: a `.jess` value has no `@` token, so a literal `@c` var() fallback is a reported gap', () => {
    expect(() => emitJess(parseLess('.a { b: var(--x, @c); }'))).toThrow(NoJessSpelling);
  });

  it('writes the valid-CSS value `--x: @c` identically in every dialect', async () => {
    const source = '.a { --x: @c; --y: calc(@c + 1px) $c; }';
    for (const dialect of ['less', 'scss', 'jess'] as const) {
      expect(await render(source, dialect)).toBe('.a { --x: @c; --y: calc(@c + 1px) $c; }');
    }
  });
});
