import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * Less's `;` rule for mixin calls and definitions (owner 2026-10-09, ledger
 * P46): when the list holds any `;`, `;` separates its arguments and EVERY `,`,
 * before or after the `;`, belongs to a comma-list value.
 */
const compiler = new Compiler({ compile: { plugins: [lessPlugin()] }, quiet: true });
const render = (source: string) => compiler.renderToResult(
  { source, filePath: 'entry.less', extension: '.less' },
  { quiet: true }
);
const css = async (source: string) => {
  const result = await render(source);
  expect(result.errors).toEqual([]);
  return result.css;
};

const TAKES = '.mixin-takes-one(@a) { one: @a; }\n.mixin-takes-two(@a; @b) { one: @a; two: @b; }\n';

describe('a mixin call with a `;` passes each comma run as one list value (P46)', () => {
  it.each([
    ['.mixin-takes-two(@a : a; @b : b, c);', 'one: a;\n  two: b, c;'],
    ['.mixin-takes-two(@a : d, e; @b : f);', 'one: d, e;\n  two: f;'],
    ['.mixin-takes-two(o, p; q);', 'one: o, p;\n  two: q;'],
    ['.mixin-takes-two(r, s; t;);', 'one: r, s;\n  two: t;'],
    ['.mixin-takes-one(m, n;);', 'one: m, n;'],
    ['.mixin-takes-one(@a : h;);', 'one: h;'],
    ['.mixin-takes-two(@b: x, y; @a: z);', 'one: z;\n  two: x, y;']
  ])('%s', async (call, declarations) => {
    await expect(css(`${TAKES}.x { ${call} }`)).resolves.toBe(`.x {\n  ${declarations}\n}\n`);
  });

  it('keeps `,` as the argument separator in a list without a `;`', async () => {
    await expect(css(`${TAKES}.x { .mixin-takes-two(k, l); }`)).resolves.toBe('.x {\n  one: k;\n  two: l;\n}\n');
  });
});

/*
 * A `;` list gives `@a` the comma list `d, e` (owner 2026-10-09), stored as the `~( … )`
 * node (P46), and `~( … )` holds a value list (owner 2026-10-09: "the parens are supposed
 * to be around a valueList"), so a parameter bound to one is that list to the list
 * functions and to a guard.
 */
describe('a comma run a `;` list passes is a list value (P46)', () => {
  it('counts and indexes it as a list', async () => {
    await expect(css('.t(@a; @b) { one: length(@a); two: extract(@a, 2); } .x { .t(d, e, f; g); }'))
      .resolves.toBe('.x {\n  one: 3;\n  two: e;\n}\n');
    await expect(css('.t(@a) { one: length(@a); } .x { .t(~(1, 2, 3)); }')).resolves.toBe('.x {\n  one: 3;\n}\n');
    await expect(css('.d(@c; @m: 2, 3, 4) { n: length(@m); o: extract(@m, 2); } .x { .d(1); }'))
      .resolves.toBe('.x {\n  n: 3;\n  o: 3;\n}\n');
  });

  it('iterates it with each()', async () => {
    await expect(css('.t(@a; @b) { each(@a, { v-@{value}: @index; }); } .x { .t(d, e; f); }'))
      .resolves.toBe('.x {\n  v-d: 1;\n  v-e: 2;\n}\n');
  });

  it('reads it in a guard', async () => {
    await expect(css('.t(@a) when (length(@a) = 2) { ok: yes; } .x { .t(d, e;); }')).resolves.toBe('.x {\n  ok: yes;\n}\n');
  });

  it('does not order the two comma runs a `;` list passes in a guard (golden mixins-guards)', async () => {
    const generic = '.g(@a, @b) when (@a < @b) { lt: yes; } .g(@a, @b) when (@a > @b) { gt: yes; } .g(@a, @b) when not (@a = @b) { ne: yes; } ';
    await expect(css(`${generic}.x { .g(a, b, c; a, b, d); }`)).resolves.toBe('.x {\n  ne: yes;\n}\n');
  });
});

describe('a mixin definition with a `;` takes each comma run as one value (P46)', () => {
  it('reads a comma-list default after `;` parameters', async () => {
    await expect(css(
      '.mixin-comma-default1(@color; @padding; @margin: 2, 2, 2, 2) { margin: @margin; }\n'
      + '.selector { .mixin-comma-default1(#33acfe; 4); }'
    )).resolves.toBe('.selector {\n  margin: 2, 2, 2, 2;\n}\n');
  });

  it('reads a comma-list default closed by a trailing `;`', async () => {
    await expect(css(
      '.mixin-comma-default2(@margin: 2, 2, 2, 2;) { margin: @margin; }\n.selector2 { .mixin-comma-default2(); }'
    )).resolves.toBe('.selector2 {\n  margin: 2, 2, 2, 2;\n}\n');
  });

  it('keeps `,` as the parameter separator in a list without a `;`', async () => {
    await expect(css(
      '.mixin-comma-default3(@margin: 2, 2, 2, 2) { margin: @margin; }\n.selector3 { .mixin-comma-default3(4,2,2,2); }'
    )).resolves.toBe('.selector3 {\n  margin: 4;\n}\n');
  });
});

describe('a `;` list error is reported at the argument (P46)', () => {
  it('places a named argument inside a comma list at that argument', async () => {
    const result = await render(`${TAKES}.x {\n  .mixin-takes-two(@a: 1, @b: 2; 3);\n}`);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'parse/invalid-mixin-argument',
      message: 'A named argument must start its ;-separated argument.',
      line: 4,
      column: 27
    });
  });
});
