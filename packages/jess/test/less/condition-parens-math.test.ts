import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A condition's own parentheses are a paren group, and a lowered `boolean()`
 * is a call (owner 2026-10-16, DESIGN-DECISIONS V35). Under `parens`/`strict`
 * math runs only inside a paren group: the parens written around a condition —
 * a mixin or CSS guard's `when (…)`, an `if()`/`boolean()` condition, a
 * condition inside `if()` — open one, so `when (1 + 2 = 3)` matches. The
 * argument of `boolean()` is a call argument (V34): `boolean(1 + 2 = 3)` keeps
 * `1 + 2` under `parens`/`strict`, while `boolean((1 + 2 = 3))` computes in
 * the condition's own parens. `always` and `parens-division` compute `+ - *`
 * everywhere and are unchanged.
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
  ['when (1 + 2 = 3)', guard('(1 + 2 = 3)'), 'y', 'y', 'y', 'y'],
  ['when ((1 + 2) = 3)', guard('((1 + 2) = 3)'), 'y', 'y', 'y', 'y'],
  ['when (1 + 2 = 3) and (2 * 2 = 4)', guard('(1 + 2 = 3) and (2 * 2 = 4)'), 'y', 'y', 'y', 'y'],
  ['when not (1 + 2 = 3)', guard('not (1 + 2 = 3)'), 'n', 'n', 'n', 'n'],
  ['when (isnumber(1 + 2))', guard('(isnumber(1 + 2))'), 'y', 'y', 'n', 'n'],
  ['when (isnumber((1 + 2)))', guard('(isnumber((1 + 2)))'), 'y', 'y', 'y', 'y'],
  ['if((1 + 2 = 3), y, n)', value('if((1 + 2 = 3), y, n)'), 'y', 'y', 'y', 'y'],
  ['if(1 + 2 = 3, y, n)', value('if(1 + 2 = 3, y, n)'), 'y', 'y', 'n', 'n'],
  ['if((1 + 2) = 3, y, n)', value('if((1 + 2) = 3, y, n)'), 'y', 'y', 'y', 'y'],
  ['(if(1 + 2 = 3, y, n))', value('(if(1 + 2 = 3, y, n))'), 'y', 'y', 'n', 'n'],
  ['if((1 + 2 = 3) and (2 * 2 = 4), y, n)', value('if((1 + 2 = 3) and (2 * 2 = 4), y, n)'), 'y', 'y', 'y', 'y'],
  ['if(not (1 + 2 = 3), y, n)', value('if(not (1 + 2 = 3), y, n)'), 'n', 'n', 'n', 'n'],
  ['boolean(1 + 2 = 3)', value('boolean(1 + 2 = 3)'), 'true', 'true', 'false', 'false'],
  ['boolean((1 + 2 = 3))', value('boolean((1 + 2 = 3))'), 'true', 'true', 'true', 'true'],
  ['boolean((1 + 2) = 3)', value('boolean((1 + 2) = 3)'), 'true', 'true', 'true', 'true'],
  ['(boolean(1 + 2 = 3))', value('(boolean(1 + 2 = 3))'), 'true', 'true', 'false', 'false']
];

describe('a condition\'s own parens open a math frame; boolean() arguments follow the math mode', () => {
  MODES.forEach((mode, index) => {
    describe(`mathMode: ${mode}`, () => {
      for (const [label, source, ...expected] of cases) {
        it(`${label} -> ${expected[index]}`, async () => {
          expect(await output(source, mode)).toBe(`.x { a: ${expected[index]}; }`);
        });
      }
      it(`.x when (1 + 2 = 3) { a: y } -> .x { a: y; }`, async () => {
        expect(await output('.x when (1 + 2 = 3) { a: y }', mode)).toBe('.x { a: y; }');
      });
    });
  });
});
