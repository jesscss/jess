import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * Ledger V35 (owner 2026-10-16). Under `parens`/`strict` math runs only inside
 * a paren group:
 * - the outermost parens of each condition of a `when` guard are not one:
 *   `when (1 + 2 = 3)` keeps `1 + 2`; every pair inside them is one, so
 *   `when ((1 + 2 = 3))` and `when ((1 + 2) = 3)` compute;
 * - in a function's arguments (`if()`, `boolean()`, `not()`, `and()`, `or()`)
 *   parens around a condition are an ordinary paren group: `if((1 + 2 = 3), y, n)`
 *   is `y`, and under `parens-division` `if((10px/2 = 5px), y, n)` divides;
 * - a bare argument is a call argument (V34) and does not compute:
 *   `boolean(1 + 2 = 3)` is `false`, `not(1 + 2 = 3)` is `true`.
 * `always` computes everything; `parens-division` computes `+ - *` everywhere.
 */
const MODES = ['always', 'parens-division', 'parens', 'strict'] as const;

async function output(source: string, mathMode: typeof MODES[number]): Promise<string> {
  const css = await new Compiler({ compile: { mathMode } }).renderString(source, { language: 'less', extension: '.less', suppressWarnings: true });
  return css.replace(/\s+/g, ' ').trim();
}

const guard = (condition: string): string =>
  `.m() when ${condition} { a: y } .m() when (default()) { a: n } .x { .m(); }`;
const value = (source: string): string => `.x { a: ${source}; }`;

/* `[label, source, always, parens-division, parens, strict]`, each the value of `.x { a }` */
const cases: ReadonlyArray<readonly [string, string, string, string, string, string]> = [
  ['when (1 + 2 = 3)', guard('(1 + 2 = 3)'), 'y', 'y', 'n', 'n'],
  ['when ((1 + 2) = 3)', guard('((1 + 2) = 3)'), 'y', 'y', 'y', 'y'],
  ['when (1 + 2 = 3) and (2 * 2 = 4)', guard('(1 + 2 = 3) and (2 * 2 = 4)'), 'y', 'y', 'n', 'n'],
  ['when not (1 + 2 = 3)', guard('not (1 + 2 = 3)'), 'n', 'n', 'y', 'y'],
  ['when (isnumber(1 + 2))', guard('(isnumber(1 + 2))'), 'y', 'y', 'n', 'n'],
  ['when (isnumber((1 + 2)))', guard('(isnumber((1 + 2)))'), 'y', 'y', 'y', 'y'],
  ['when (10px/2 = 5px)', guard('(10px/2 = 5px)'), 'y', 'n', 'n', 'n'],
  ['when ((10px/2) = 5px)', guard('((10px/2) = 5px)'), 'y', 'y', 'y', 'y'],
  ['when ((1 + 2 = 3))', guard('((1 + 2 = 3))'), 'y', 'y', 'y', 'y'],
  ['when (((1 + 2 = 3)))', guard('(((1 + 2 = 3)))'), 'y', 'y', 'y', 'y'],
  ['when not ((1 + 2 = 3))', guard('not ((1 + 2 = 3))'), 'n', 'n', 'n', 'n'],
  ['when ((1 + 2 = 3)) and ((2 * 2 = 4))', guard('((1 + 2 = 3)) and ((2 * 2 = 4))'), 'y', 'y', 'y', 'y'],
  ['when ((1 + 2 = 3)) and (2 * 2 = 4)', guard('((1 + 2 = 3)) and (2 * 2 = 4)'), 'y', 'y', 'n', 'n'],
  ['when (1 = 2), ((1 + 2 = 3))', guard('(1 = 2), ((1 + 2 = 3))'), 'y', 'y', 'y', 'y'],
  ['when (1 = 2), (1 + 2 = 3)', guard('(1 = 2), (1 + 2 = 3)'), 'y', 'y', 'n', 'n'],
  ['when ((1 + 2 = 3) and (2 * 2 = 4))', guard('((1 + 2 = 3) and (2 * 2 = 4))'), 'y', 'y', 'y', 'y'],
  ['when (1 + 2 = 3 and (2 * 2 = 4))', guard('(1 + 2 = 3 and (2 * 2 = 4))'), 'y', 'y', 'n', 'n'],
  ['when ((1 + 2 = 3 and 2 * 2 = 4))', guard('((1 + 2 = 3 and 2 * 2 = 4))'), 'y', 'y', 'y', 'y'],
  ['if((1 + 2 = 3), y, n)', value('if((1 + 2 = 3), y, n)'), 'y', 'y', 'y', 'y'],
  ['if(1 + 2 = 3, y, n)', value('if(1 + 2 = 3, y, n)'), 'y', 'y', 'n', 'n'],
  ['if((1 + 2) = 3, y, n)', value('if((1 + 2) = 3, y, n)'), 'y', 'y', 'y', 'y'],
  ['(if(1 + 2 = 3, y, n))', value('(if(1 + 2 = 3, y, n))'), 'y', 'y', 'n', 'n'],
  ['if((1 + 2 = 3) and (2 * 2 = 4), y, n)', value('if((1 + 2 = 3) and (2 * 2 = 4), y, n)'), 'y', 'y', 'y', 'y'],
  ['if(not (1 + 2 = 3), y, n)', value('if(not (1 + 2 = 3), y, n)'), 'n', 'n', 'n', 'n'],
  ['if((10px/2 = 5px), y, n)', value('if((10px/2 = 5px), y, n)'), 'y', 'y', 'y', 'y'],
  ['if(10px/2 = 5px, y, n)', value('if(10px/2 = 5px, y, n)'), 'y', 'n', 'n', 'n'],
  ['statement if((1 + 2 = 3), {…}, {…})', '.x { if((1 + 2 = 3), { a: y }, { a: n }); }', 'y', 'y', 'y', 'y'],
  ['statement if(1 + 2 = 3, {…}, {…})', '.x { if(1 + 2 = 3, { a: y }, { a: n }); }', 'y', 'y', 'n', 'n'],
  ['foo((10px/2 = 5px))', value('foo((10px/2 = 5px))'), 'foo(true)', 'foo(true)', 'foo(true)', 'foo(true)'],
  ['(10px/2 = 5px)', value('(10px/2 = 5px)'), '(5px = 5px)', '(5px = 5px)', '(5px = 5px)', '(5px = 5px)'],
  ['boolean(1 + 2 = 3)', value('boolean(1 + 2 = 3)'), 'true', 'true', 'false', 'false'],
  ['boolean((1 + 2 = 3))', value('boolean((1 + 2 = 3))'), 'true', 'true', 'true', 'true'],
  ['boolean((1 + 2) = 3)', value('boolean((1 + 2) = 3)'), 'true', 'true', 'true', 'true'],
  ['(boolean(1 + 2 = 3))', value('(boolean(1 + 2 = 3))'), 'true', 'true', 'false', 'false'],
  ['boolean((10px/2 = 5px))', value('boolean((10px/2 = 5px))'), 'true', 'true', 'true', 'true'],
  ['not(1 + 2 = 3)', value('not(1 + 2 = 3)'), 'false', 'false', 'true', 'true'],
  ['not((1 + 2 = 3))', value('not((1 + 2 = 3))'), 'false', 'false', 'false', 'false'],
  ['and(1 + 2 = 3, 1 = 1)', value('and(1 + 2 = 3, 1 = 1)'), 'true', 'true', 'false', 'false'],
  ['and((1 + 2 = 3), 1 = 1)', value('and((1 + 2 = 3), 1 = 1)'), 'true', 'true', 'true', 'true'],
  ['or(1 + 2 = 3, 1 = 2)', value('or(1 + 2 = 3, 1 = 2)'), 'true', 'true', 'false', 'false'],
  ['or((1 + 2 = 3), 1 = 2)', value('or((1 + 2 = 3), 1 = 2)'), 'true', 'true', 'true', 'true']
];

describe('when ( … ) parens are not a math group; function arguments follow the math mode', () => {
  MODES.forEach((mode, index) => {
    describe(`mathMode: ${mode}`, () => {
      for (const [label, source, ...expected] of cases) {
        it(`${label} -> ${expected[index]}`, async () => {
          expect(await output(source, mode)).toBe(`.x { a: ${expected[index]}; }`);
        });
      }
      it('a ruleset\'s when (1 + 2 = 3) is not a math group', async () => {
        expect(await output('.x when (1 + 2 = 3) { a: y }', mode)).toBe(index < 2 ? '.x { a: y; }' : '');
      });
      it('a ruleset\'s when ((1 + 2 = 3)) computes in its inner group', async () => {
        expect(await output('.x when ((1 + 2 = 3)) { a: y }', mode)).toBe('.x { a: y; }');
      });
      it('a ruleset\'s when (1 = 2), ((1 + 2 = 3)) computes in its inner group', async () => {
        expect(await output('.x when (1 = 2), ((1 + 2 = 3)) { a: y }', mode)).toBe('.x { a: y; }');
      });

      /*
       * A `/` inside an inner pair of a `when` guard should divide (ledger V35),
       * as `when ((10px/2) = 5px)` does. The Less grammar folds a guard
       * comparison's operands before it knows whether an inner pair wraps it, so
       * under `parens-division`/`parens`/`strict` the `/` is still a separator.
       * Pinned as a known gap until the grammar defers that fold (DESIGN-DECISIONS-NOTES V35).
       */
      (index === 0 ? it : it.fails)('when ((10px/2 = 5px)) divides in its inner group', async () => {
        expect(await output(guard('((10px/2 = 5px))'), mode)).toBe('.x { a: y; }');
      });
      (index === 0 ? it : it.fails)('a ruleset\'s when ((10px/2 = 5px)) divides in its inner group', async () => {
        expect(await output('.x when ((10px/2 = 5px)) { a: y }', mode)).toBe('.x { a: y; }');
      });
    });
  });
});
