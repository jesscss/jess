import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';
import { parse as parseCss } from '@jesscss/css-parser';
import { parse as parseLess } from '@jesscss/less-parser';
import { parse as parseScss } from '@jesscss/scss-parser';
import { parse as parseJess } from '@jesscss/jess-parser';

/**
 * NamedColor→Keyword convergence (task #57).
 *
 * A CSS construct has ONE node representation across all four grammars: a named
 * color (`red`) parses as a `Keyword`, never a dialect-specific `Color`
 * production. Its colour-ness is materialized to a `Color` value ONLY at a point
 * of USE — a `Color`-typed function parameter, arithmetic, or a color type
 * predicate — so an un-operated `color: red` still emits its verbatim bytes.
 *
 * See docs/architecture/core/DESIGN-DECISIONS.md (NamedColor→Keyword row) and
 * SEMANTIC-INVARIANTS.md §"one representation per CSS construct".
 */

/** Depth-first search for the value-type label a named color parses to. */
function redType(node: unknown, depth = 0): string | undefined {
  if (depth > 40 || node === null || typeof node !== 'object') {
    return undefined;
  }
  const record = node as Record<string, unknown>;
  const type = record.type;
  if (
    (type === 'Keyword' || type === 'Color')
    && (record.src === 'red' || record.value === 'red' || record.text === 'red')
  ) {
    return type;
  }
  for (const key of Object.keys(record)) {
    const found = redType(record[key], depth + 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe('NamedColor→Keyword convergence', () => {
  it('parses `red` as a Keyword in every dialect (one node per CSS construct)', () => {
    const source = 'a { color: red; }';
    expect(redType(parseCss(source)), 'css').toBe('Keyword');
    expect(redType(parseLess(source)), 'less').toBe('Keyword');
    expect(redType(parseScss(source)), 'scss').toBe('Keyword');
    expect(redType(parseJess(source)), 'jess').toBe('Keyword');
  });

  it('emits an un-operated named color verbatim in every dialect', async () => {
    const compiler = new Compiler();
    for (const extension of ['.less', '.scss', '.jess'] as const) {
      const css = await compiler.renderString('a { color: red; }', { extension, suppressWarnings: true });
      expect(String(css), extension).toContain('color: red');
    }
  });

  it('materializes a named color to a Color where a dialect operates on it', async () => {
    const compiler = new Compiler();

    /*
     * Both Less and Sass own a `lighten` builtin with a `Color`-typed first
     * parameter; the named-color keyword now satisfies it and folds identically.
     */
    for (const extension of ['.less', '.scss'] as const) {
      const css = await compiler.renderString('a { color: lighten(red, 10%); }', { extension, suppressWarnings: true });
      expect(String(css), extension).toContain('color: #ff3333');
    }
  });

  it('coerces a named-color keyword operand in color arithmetic', async () => {
    const compiler = new Compiler();
    for (const extension of ['.less', '.scss'] as const) {
      const css = await compiler.renderString('a { color: red + #111; }', { extension, suppressWarnings: true });
      expect(String(css), extension).toContain('color: #ff1111');
    }
  });

  it('keeps a named color a color for Less type predicates', async () => {
    const compiler = new Compiler();
    const iscolor = await compiler.renderString('a { b: iscolor(red); }', { extension: '.less', suppressWarnings: true });
    expect(String(iscolor)).toContain('b: true');
    const iskeyword = await compiler.renderString('a { b: iskeyword(red); }', { extension: '.less', suppressWarnings: true });
    expect(String(iskeyword)).toContain('b: false');

    // A non-color keyword is still a keyword, not a color.
    const plain = await compiler.renderString('a { b: iskeyword(inherit); }', { extension: '.less', suppressWarnings: true });
    expect(String(plain)).toContain('b: true');
  });

  it('matches a named color against a Less mixin guard type predicate', async () => {
    /*
     * The guard-condition predicate path (value-guards.ts typeCheck) is distinct
     * from the standalone value-domain `iscolor`; both must treat a named-color
     * keyword as a color. `.m(green)` has no literal pattern, so it can only match
     * through `when (iscolor(@x))`.
     */
    const compiler = new Compiler();
    const css = await compiler.renderString(
      '.w { .m(@x) when (iscolor(@x)) { c: @x } .k(@x) when (iskeyword(@x)) { d: @x } &-a { .m(green) } &-b { .k(inherit) } &-c { .k(green) } }',
      { extension: '.less', suppressWarnings: true }
    );
    expect(String(css)).toContain('c: green');   // green is a color → iscolor guard fires
    expect(String(css)).toContain('d: inherit'); // inherit is a keyword → iskeyword guard fires
    expect(String(css)).not.toContain('d: green'); // green is NOT a plain keyword
  });

  it('reports a named color as `color` for Sass `type-of`', async () => {
    const compiler = new Compiler();
    const color = await compiler.renderString('a { b: type-of(red); }', { extension: '.scss', suppressWarnings: true });
    expect(String(color)).toContain('b: color');
    const string = await compiler.renderString('a { b: type-of(foo); }', { extension: '.scss', suppressWarnings: true });
    expect(String(string)).toContain('b: string');
  });

  it('folds a named-color keyword operand under Less math: always, like a hex color', async () => {
    /*
     * A named color reaching an operation materializes to its Color and computes,
     * identically to a hex color and matching lessc 4.x. `red * 2` clamps each
     * channel: (510→255, 0, 0) = #ff0000. Bare `red / 2` folds too — the
     * bare-slash promotion (serialize.ts appendBareSlashTokens) admits the
     * named-color leaf, so `red / 2` → #800000 exactly like `#ff0000 / 2`.
     */
    const compiler = new Compiler({ compile: { mathMode: 'always' } });
    const mul = await compiler.renderString('.t { color: red * 2; }', { extension: '.less', suppressWarnings: true });
    expect(String(mul)).toContain('color: #ff0000');
    const div = await compiler.renderString('.t { color: red / 2; }', { extension: '.less', suppressWarnings: true });
    expect(String(div)).toContain('color: #800000');
    const hexDiv = await compiler.renderString('.t { color: #ff0000 / 2; }', { extension: '.less', suppressWarnings: true });
    expect(String(hexDiv)).toContain('color: #800000');
  });
});
