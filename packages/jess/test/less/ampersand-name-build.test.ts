/**
 * A `&` glued to an identifier continuation builds a name on its parent (`&-1`,
 * `&__el`): Less name concatenation, not CSS nesting (owner 2026-07-23/24).
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

type Mode = false | 'native' | 'compact';

async function render(source: string, collapseNesting: Mode, extension = '.less'): Promise<string> {
  return String(await new Compiler({ output: { collapseNesting } }).renderString(source, { extension, suppressWarnings: true }));
}

describe('a name a & builds', () => {
  /*
   * `-1` is no identifier, so `.col { &-1 {} }` written as nested CSS would be dropped:
   * the rule is written flattened at the top, as the migration guide shows (ledger O17).
   */
  it('is written flattened in nested output where nested it would be no selector', async () => {
    const source = '.col { &-1 { width: 8.333%; } &-2 { width: 16.666%; } }';
    const flat = '.col-1 {\n  width: 8.333%;\n}\n.col-2 {\n  width: 16.666%;\n}\n';
    await expect(render(source, false)).resolves.toBe(flat);
    await expect(render(source, 'native')).resolves.toBe(flat);
    await expect(render('.a { b: c; @media print { &-1 { d: e; } } &-x { f: g; } }', false))
      .resolves.toBe('.a {\n  b: c;\n  &-x {\n    f: g;\n  }\n}\n@media print {\n  .a-1 {\n    d: e;\n  }\n}\n');
  });

  /* Built on a parent list as one `:is()` it would be no selector (`:is(.a, .b)__el`). */
  it('is built on each parent of a list, in .scss as in Less and .jess', async () => {
    for (const mode of ['native', 'compact'] as const) {
      for (const extension of ['.scss', '.less', '.jess']) {
        await expect(render('.a, .b { &__el { x: 1; } }', mode, extension), `${extension} ${mode}`)
          .resolves.toBe('.a__el,\n.b__el {\n  x: 1;\n}\n');
      }
      await expect(render('.a .b, .c { &-m { x: 1; } }', mode, '.scss')).resolves.toBe('.a .b-m,\n.c-m {\n  x: 1;\n}\n');
      await expect(render('.t { m: 1; } .a, .b { &__el { @extend .t; } }', mode, '.scss'))
        .resolves.toBe('.t,\n.a__el,\n.b__el {\n  m: 1;\n}\n');
    }
  });
});
