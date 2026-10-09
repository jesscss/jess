/**
 * A `&` glued to a name continuation builds a name on its parent (`&__el`, `&--m`,
 * `&-1`): Less name concatenation, not CSS nesting (owner 2026-07-23/24, ledger J13).
 * CSS nesting reads `.block { &__el {} }` as `&` then the type selector `__el`, and a
 * browser drops `&-1`, so nested output writes every such rule flattened, the name
 * built, where it stands: the blocks it rises out of close before it and open again
 * after it, so the output keeps the collapsed output's order (its cascade).
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

type Mode = false | 'native' | 'compact';

async function render(source: string, collapseNesting: Mode, extension = '.less', compress = false): Promise<string> {
  return String(await new Compiler({ output: { collapseNesting, compress } }).renderString(source, { extension, suppressWarnings: true }));
}

/** The output in nested mode and in both collapsed modes. */
async function everyMode(source: string, extension = '.less'): Promise<Record<string, string>> {
  return {
    nested: await render(source, false, extension),
    native: await render(source, 'native', extension),
    compact: await render(source, 'compact', extension)
  };
}

const same = (css: string): Record<string, string> => ({ nested: css, native: css, compact: css });

describe('a name a & builds', () => {
  it('is written flattened in nested output, as in collapsed output', async () => {
    await expect(everyMode('.block { color: red; &__el { color: blue; } &--mod { color: green; } }'))
      .resolves.toEqual(same('.block {\n  color: red;\n}\n.block__el {\n  color: blue;\n}\n.block--mod {\n  color: green;\n}\n'));
    await expect(everyMode('.col { &-1 { width: 8.333%; } &-2 { width: 16.666%; } }'))
      .resolves.toEqual(same('.col-1 {\n  width: 8.333%;\n}\n.col-2 {\n  width: 16.666%;\n}\n'));
    await expect(everyMode('.b { &__e { &--m { x: 1; } } }')).resolves.toEqual(same('.b__e--m {\n  x: 1;\n}\n'));
    await expect(everyMode('@s: el; .b { &-@{s} { y: 1; } .c:not(&__x) { z: 2; } }'))
      .resolves.toEqual(same('.b-el {\n  y: 1;\n}\n.c:not(.b__x) {\n  z: 2;\n}\n'));
  });

  it('keeps the declarations around it before and after it, its children under it', async () => {
    const css = '.block {\n  a: 1;\n}\n.block__el {\n  b: 2;\n}\n.block__el:hover {\n  c: 3;\n}\n.block__el .i {\n  d: 4;\n}\n.block {\n  e: 5;\n}\n';
    await expect(everyMode('.block { a: 1; &__el { b: 2; &:hover { c: 3; } .i { d: 4; } } e: 5; }')).resolves.toEqual(same(css));

    // A modifier on the same element as its block wins as it is written: after it here, before it there.
    await expect(render('.btn { &--primary { color: white; } color: black; }', false))
      .resolves.toBe('.btn--primary {\n  color: white;\n}\n.btn {\n  color: black;\n}\n');
    await expect(render('.btn { color: black; &--primary { color: white; } border: 0; }', false))
      .resolves.toBe('.btn {\n  color: black;\n}\n.btn--primary {\n  color: white;\n}\n.btn {\n  border: 0;\n}\n');
    await expect(render('.b { a: 0; &__x { y: 1; } z: 2; }', false, '.less', true)).resolves.toBe('.b{a:0}.b__x{y:1}.b{z:2}');
  });

  it('rises out of every rule block it is in, inside the at-rules it is in', async () => {
    await expect(render('.a { .b { &__x { y: 1; } } .c { z: 2; } }', false))
      .resolves.toBe('.a .b__x {\n  y: 1;\n}\n.a {\n  .c {\n    z: 2;\n  }\n}\n');
    await expect(render('.a { @media print { .b { &__x { y: 1; } z: 2; } } w: 3; }', false))
      .resolves.toBe('@media print {\n  .a .b__x {\n    y: 1;\n  }\n}\n.a {\n  @media print {\n    .b {\n      z: 2;\n    }\n  }\n  w: 3;\n}\n');
    await expect(render('@media print { .b { a: 0; &__x { y: 1; } z: 2; } }', false))
      .resolves.toBe('@media print {\n  .b {\n    a: 0;\n  }\n  .b__x {\n    y: 1;\n  }\n  .b {\n    z: 2;\n  }\n}\n');
    await expect(render('.a { b: c; @media print { &-1 { d: e; } } &-x { f: g; } }', false))
      .resolves.toBe('.a {\n  b: c;\n}\n@media print {\n  .a-1 {\n    d: e;\n  }\n}\n.a-x {\n  f: g;\n}\n');
  });

  it('leaves the blocks whole when it writes nothing', async () => {
    await expect(render('.b { a: 0; &__x when (false) { y: 1; } z: 2; }', false)).resolves.toBe('.b {\n  a: 0;\n  z: 2;\n}\n');
    await expect(render('.b { a: 0; &__x when (false) { y: 1; } z: 2; }', false, '.less', true)).resolves.toBe('.b{a:0;z:2}');
  });

  it('is built on the rule a mixin body is placed in', async () => {
    await expect(render('.m() { &__x { a: 1; } } .b { .m() !important; }', false)).resolves.toBe('.b__x {\n  a: 1 !important;\n}\n');
    await expect(render('@d: { &__x { y: 1; } }; .b { @d(); z: 2; }', false)).resolves.toBe('.b__x {\n  y: 1;\n}\n.b {\n  z: 2;\n}\n');
  });

  it('leaves a & that references its parent nested', async () => {
    await expect(render('.a { &.x { b: 1; } &:hover { c: 2; } & > .c { d: 3; } .y& { e: 4; } }', false))
      .resolves.toBe('.a {\n  &.x {\n    b: 1;\n  }\n  &:hover {\n    c: 2;\n  }\n  & > .c {\n    d: 3;\n  }\n  .y& {\n    e: 4;\n  }\n}\n');
  });

  /* Built on a parent list as one `:is()` it would be no selector (`:is(.a, .b)__el`). */
  it('is built on each parent of a list, in .scss as in Less and .jess', async () => {
    for (const extension of ['.scss', '.less', '.jess']) {
      await expect(everyMode('.a, .b { &__el { x: 1; } }', extension), extension)
        .resolves.toEqual(same('.a__el,\n.b__el {\n  x: 1;\n}\n'));
    }
    await expect(everyMode('.a .b, .c { &-m { x: 1; } }', '.scss')).resolves.toEqual(same('.a .b-m,\n.c-m {\n  x: 1;\n}\n'));
    await expect(everyMode('.t { m: 1; } .a, .b { &__el { @extend .t; } }', '.scss'))
      .resolves.toEqual(same('.t,\n.a__el,\n.b__el {\n  m: 1;\n}\n'));
  });
});
