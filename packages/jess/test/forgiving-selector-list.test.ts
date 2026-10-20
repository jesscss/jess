import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * `:is()` and `:where()` take a `<forgiving-selector-list>` (Selectors 4 §4.2,
 * §4.4, §16.1): an item that is not a selector is dropped by a browser and the
 * others still match, so `.card:is(.active, 1px)` matches as
 * `.card:is(.active)`, and `.a:is(1px)` / `.a:is()` are valid selectors that
 * match nothing. Owner 2026-10-20: "it should parse then... sure warning is
 * ok". In every dialect the item is written as authored, with one
 * `css/forgiving-selector-item` warning where it is written, and the compile
 * succeeds. `:not()` and `:has()` take a strict list and are unchanged.
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';
const DIALECTS: readonly Dialect[] = ['css', 'less', 'scss', 'jess'];

async function render(dialect: Dialect, source: string) {
  const result = await new Compiler().renderToResult({ source, filePath: `/proj/forgiving.${dialect}` }, {});
  return {
    css: String(result.css),
    errors: result.errors.map(error => [error.code, error.line, error.column]),
    warnings: result.warnings.map(warning => [warning.code, warning.line, warning.column, warning.message])
  };
}

describe('the forgiving selector list of :is() and :where()', () => {
  for (const dialect of DIALECTS) {
    it(`${dialect}: writes .card:is(.active, 1px) as authored and warns at 1px`, async () => {
      expect(await render(dialect, '.card:is(.active, 1px) { color: red; }')).toEqual({
        css: '.card:is(.active, 1px) {\n  color: red;\n}\n',
        errors: [],
        warnings: [['css/forgiving-selector-item', 1, 19, '`1px` is not a selector; browsers ignore it here']]
      });
    });

    it(`${dialect}: writes .a:where(1px) and .a:is() as authored`, async () => {
      expect(await render(dialect, '.a:where(1px) { color: red; }\n.b:is() { color: red; }')).toEqual({
        css: '.a:where(1px) {\n  color: red;\n}\n.b:is() {\n  color: red;\n}\n',
        errors: [],
        warnings: [['css/forgiving-selector-item', 1, 10, '`1px` is not a selector; browsers ignore it here']]
      });
    });

    it(`${dialect}: warns once for an item in a nested rule`, async () => {
      expect(await render(dialect, '.a {\n  &:is(.b, 2px) { color: red; }\n}')).toMatchObject({
        errors: [],
        warnings: [['css/forgiving-selector-item', 2, 12, '`2px` is not a selector; browsers ignore it here']]
      });
    });
  }

  it.each([
    ['less', '@s: selector(.a:is(1px));\n@{s} { color: red; }'],
    ['jess', '$s: selector(.a:is(1px));\n${s} { color: red; }']
  ] as const)('%s: a selector capture keeps the item, and the compile warns', async (dialect, source) => {
    expect(await render(dialect, source)).toEqual({
      css: '.a:is(1px) {\n  color: red;\n}\n',
      errors: [],
      warnings: [['css/forgiving-selector-item', 1, 20, '`1px` is not a selector; browsers ignore it here']]
    });
  });

  it('less: an item reads an interpolated pseudo argument', async () => {
    expect(await render('less', '@t: ~".b";\n.x:is(.a:not(@{t})) { color: red; }')).toEqual({
      css: '.x:is(.a:not(.b)) {\n  color: red;\n}\n',
      errors: [],
      warnings: []
    });
  });

  it('less: a capture cannot hold an interpolated item', async () => {
    expect((await render('less', '.x { a: selector(.a:is(@{t})); }')).errors).toEqual([['parse/selector-capture-argument', 1, 24]]);
  });

  for (const dialect of DIALECTS) {
    it(`${dialect}: :not() and :has() still take a strict selector list`, async () => {
      expect((await render(dialect, '.x:not(2n+1) { color: red; }')).errors).toMatchObject([['parse/syntax-error', 1, expect.any(Number)]]);
      expect((await render(dialect, '.x:has(2n+1) { color: red; }')).errors).toMatchObject([['parse/syntax-error', 1, expect.any(Number)]]);
    });
  }
});
