import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Placeholder selectors, end to end.
 *
 * SCSS spells one `%name`; `.jess` spells it `\\name` and SCSS LOWERS to that,
 * so both dialects reduce to the same node and extend across each other. Two
 * backslashes because `\\` is the CSS escape for a literal `\` (css-syntax-3
 * 4.3.7): the result is a well-formed identifier that no element type can match
 * (selectors-4 5.1), so a placeholder is inert BY CONSTRUCTION. Suppression
 * exists to match dart-sass's output, not to make the selector safe.
 *
 * Every expectation below was taken from dart-sass 1.101.0 on the same source.
 */
const render = (src: string, extension = '.scss') =>
  new Compiler().renderString(src, { extension });

describe('placeholder selectors', () => {
  it('emits nothing on its own', async () => {
    expect(await render('%ph { color: red; }\n')).toBe('');
  });

  it('emits only the extender when extended', async () => {
    // dart-sass: `.a { color: red; }` -- the `%ph` branch never appears.
    expect(await render('%ph { color: red; }\n.a { @extend %ph; }\n'))
      .toBe('.a {\n  color: red;\n}\n');
  });

  it('drops only the placeholder BRANCH of a selector list, keeping its siblings', async () => {
    /*
     * The case that proves suppression is per-BRANCH, not per-rule, and the
     * reason `Ruleset.reference` could not carry it: a whole-rule flag would
     * drop `.a` too. dart-sass: `.a { color: red; }`.
     */
    expect(await render('%ph, .a { color: red; }\n')).toBe('.a {\n  color: red;\n}\n');
  });

  it('suppresses a placeholder branch in nested output', async () => {
    // Nested output is the v5 default and takes a different emit path from the
    // flattened one, so it needs its own coverage.
    expect(await render('.o { %ph { color: red; } }\n')).toBe('');
  });

  it('round-trips the `.jess` `\\\\name` spelling through $extend', async () => {
    expect(await render('\\\\ph { color: red; }\n.a { $extend \\\\ph; }\n', '.jess'))
      .toBe('.a {\n  color: red;\n}\n');
  });

  it('accepts a placeholder $extend target under the default policy', async () => {
    // `allowExtendSelectors` defaults to class-only for `$apply`, but a
    // placeholder is the one purpose-built extend target, so it is admitted by
    // default rather than being the shape you had to opt into.
    await expect(render('\\\\ph { color: red; }\n.a { $extend \\\\ph; }\n', '.jess'))
      .resolves.toBeTypeOf('string');
  });

  it('parses `@extend ... !optional` and records it', async () => {
    // A missing target is currently silent for BOTH spellings, so this matches
    // dart-sass while plain `@extend` does not yet (dart-sass errors). The
    // authored flag is recorded so that diagnostic is an engine change alone.
    expect(await render('.a { @extend %missing !optional; }\n')).toBe('');
  });

  /*
   * A placeholder a mixin call places is extended exactly as one written where the
   * `@include` stands: placement is evaluation, so where a rule came from cannot change
   * the output (ledger X22; extend folds after the one walk, X12).
   */
  describe('placed by @include (jess#499)', () => {
    const renderIn = (src: string, collapseNesting: false | 'native' | 'compact', compress = false) =>
      new Compiler({ output: { collapseNesting, compress } }).renderString(src, { extension: '.scss' });

    it('keeps the extend of a placeholder the mixin places', async () => {
      const src = [
        '%button-base {',
        '  padding: 4px 8px;',
        '  border: 1px solid;',
        '}',
        '',
        '@mixin button-styles {',
        '  %button-reset {',
        '    margin: 0;',
        '    background: none;',
        '  }',
        '}',
        '',
        '@include button-styles;',
        '',
        '.btn {',
        '  @extend %button-reset;',
        '  @extend %button-base;',
        '  color: blue;',
        '}',
        ''
      ].join('\n');
      const expected = '.btn {\n  padding: 4px 8px;\n  border: 1px solid;\n}\n'
        + '.btn {\n  margin: 0;\n  background: none;\n}\n'
        + '.btn {\n  color: blue;\n}\n';
      expect(await renderIn(src, false)).toBe(expected);
      expect(await renderIn(src, 'native')).toBe(expected);
    });

    const shapes: Array<[placeholder: string, rest: string]> = [
      ['%ph { a: b; }', '.x { @extend %ph; } .y { @extend %ph; }'],
      ['%ph { a: b; .c { d: e; } }', '.x { @extend %ph; }'],
      ['%ph { a: b; .c { d: e; } }', '.a { x: y; } .b { @extend .a; }'],
      ['%ph { a: b; &-e { c: d; } e: f; }', '.a { x: y; } .b { @extend .a; }'],
      ['%ph { .c { d: e; } }', '.x { @extend .c; }']
    ];
    for (const [placeholder, rest] of shapes) {
      for (const inRule of [false, true]) {
        const written = `${inRule ? `.w { ${placeholder} }` : placeholder} ${rest}`;
        const placed = `@mixin m { ${placeholder} } ${inRule ? '.w { @include m; }' : '@include m;'} ${rest}`;
        it(`places \`${written}\` as written`, async () => {
          for (const mode of [false, 'native', 'compact'] as const) {
            for (const compress of [false, true]) {
              expect(await renderIn(placed, mode, compress), `${String(mode)} compress=${String(compress)}`)
                .toBe(await renderIn(written, mode, compress));
            }
          }
        });
      }
    }

    // PINNED-DEFECTS-AUDIT DF12: the blanked placeholder leaves `@media print {}`.
    it.fails('leaves nothing for a placed placeholder an extend names but cannot reach', async () => {
      const src = '@mixin m { @media print { %ph { a: b; } } }\n@include m;\n@media screen { .x { @extend %ph; } }\n';
      expect(await renderIn(src, false)).toBe('');
    });

    it('extends a placeholder the mixin places inside a rule', async () => {
      const src = '@mixin m { %ph { a: b; } }\n.w { @include m; }\n.x { @extend %ph; }\n';
      expect(await renderIn(src, 'native')).toBe('.w .x {\n  a: b;\n}\n');
      expect(await renderIn(src, false)).toBe('.w {\n  .x {\n    a: b;\n  }\n}\n');
    });
  });
});
