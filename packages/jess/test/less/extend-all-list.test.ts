import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * Owner 2026-10-09, verbatim: "`all` only applies to target right before,
 * `!all` is supposed to apply to the entire seletor list". So in one
 * `:extend(…)`, `!all` makes every target a partial match, and `all` only the
 * target written before it.
 */
const render = async (source: string) => {
  const result = await new Compiler().renderToResult({ source, filePath: '/proj/extend.less' }, {});
  expect(result.errors).toEqual([]);
  return String(result.css);
};

const SHEET = '.a .x { p: 1 } .b .y { q: 2 } ';

describe('an extend `!all` applies to the whole target list', () => {
  it('extends partial matches of every target in a body extend', async () => {
    expect(await render(`${SHEET}.c { &:extend(.x, .y !all); }`)).toBe(
      '.a :is(.x, .c) {\n  p: 1;\n}\n.b :is(.y, .c) {\n  q: 2;\n}\n'
    );
  });

  it('extends partial matches of every target in an inline extend', async () => {
    expect(await render(`${SHEET}.c:extend(.x, .y !all) { r: 3 }`)).toBe(
      '.a :is(.x, .c) {\n  p: 1;\n}\n.b :is(.y, .c) {\n  q: 2;\n}\n.c {\n  r: 3;\n}\n'
    );
  });

  it('keeps `all` on the target written before it', async () => {
    expect(await render(`${SHEET}.c { &:extend(.x, .y all); }`)).toBe(
      '.a .x {\n  p: 1;\n}\n.b :is(.y, .c) {\n  q: 2;\n}\n'
    );
    expect(await render(`${SHEET}.c { &:extend(.x all, .y); }`)).toBe(
      '.a :is(.x, .c) {\n  p: 1;\n}\n.b .y {\n  q: 2;\n}\n'
    );
  });
});
