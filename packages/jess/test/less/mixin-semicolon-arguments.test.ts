import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

/**
 * Less's `;` rule for mixin calls and definitions (owner 2026-10-09, ledger
 * P45): when the list holds any `;`, `;` separates its arguments and EVERY `,`,
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

describe('a mixin call with a `;` passes each comma run as one list value (P45)', () => {
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

describe('a mixin definition with a `;` takes each comma run as one value (P45)', () => {
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

describe('a `;` list error is reported at the argument (P45)', () => {
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
