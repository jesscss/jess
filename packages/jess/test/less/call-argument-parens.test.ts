import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A call's arguments do not inherit the parentheses written around the call
 * (owner 2026-10-15, DESIGN-DECISIONS V34). Under `parens`/`strict` math runs
 * only inside a paren group, and the group that counts is the nearest one: the
 * call boundary sits between `(foo(` and `1 + 2`, so `(foo(1 + 2))` stays
 * `(foo(1 + 2))`. A group written INSIDE an argument still computes:
 * `(foo((1 + 2)))` is `(foo(3))`. `parens-division` computes `+ - *`
 * everywhere and `/` only inside a group; `always` computes everything.
 */
const MODES = ['always', 'parens-division', 'parens', 'strict'] as const;

async function value(source: string, mathMode: typeof MODES[number]): Promise<string> {
  const css = await new Compiler({ compile: { mathMode } }).renderString(`.x { a: ${source}; }`, { language: 'less', extension: '.less' });
  return css.replace(/\s+/g, ' ').trim().replace(/^\.x \{ a: (.*); \}$/, '$1');
}

/* `[source, always, parens-division, parens, strict]` */
const cases: ReadonlyArray<readonly [string, string, string, string, string]> = [
  ['foo(1 + 2)', 'foo(3)', 'foo(3)', 'foo(1 + 2)', 'foo(1 + 2)'],
  ['(foo(1 + 2))', '(foo(3))', '(foo(3))', '(foo(1 + 2))', '(foo(1 + 2))'],
  ['(foo((1 + 2)))', '(foo(3))', '(foo(3))', '(foo(3))', '(foo(3))'],
  ['(1 + 2)', '3', '3', '3', '3'],
  ['(foo(2 * 3px))', '(foo(6px))', '(foo(6px))', '(foo(2 * 3px))', '(foo(2 * 3px))'],
  ['foo(10px/2)', 'foo(5px)', 'foo(10px / 2)', 'foo(10px / 2)', 'foo(10px / 2)'],
  ['(foo(10px/2))', '(foo(5px))', '(foo(10px / 2))', '(foo(10px / 2))', '(foo(10px / 2))'],
  ['(foo((10px/2)))', '(foo(5px))', '(foo(5px))', '(foo(5px))', '(foo(5px))'],
  ['(10px/2)', '5px', '5px', '5px', '5px'],
  ['(foo(bar(1 + 2)))', '(foo(bar(3)))', '(foo(bar(3)))', '(foo(bar(1 + 2)))', '(foo(bar(1 + 2)))'],
  ['(foo((bar(1 + 2))))', '(foo((bar(3))))', '(foo((bar(3))))', '(foo((bar(1 + 2))))', '(foo((bar(1 + 2))))']
];

describe('a call\'s arguments do not inherit the parens around the call', () => {
  MODES.forEach((mode, index) => {
    describe(`mathMode: ${mode}`, () => {
      for (const [source, ...expected] of cases) {
        it(`${source} -> ${expected[index]}`, async () => {
          expect(await value(source, mode)).toBe(expected[index]);
        });
      }
    });
  });
});
