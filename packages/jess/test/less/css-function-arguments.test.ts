/**
 * Owner 2026-10-09: "every CSS function should be evaluating args" (ordinary
 * declarations; a custom-property value stays as authored, P2), and of `var()`:
 * "why is var() special??". F5 was rewritten the same day: a CSS colour call stays
 * a CSS call, never converted to hex, but its arguments evaluate (`rgb(@a + 1, 2, 3)`
 * → `rgb(11, 2, 3)`).
 *
 * The implementation is queued separately. Each `it.fails` below asserts the ruled
 * output, so it passes while the code is wrong and turns red when the fix lands:
 * then change it to `it`.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

const render = async (less: string): Promise<string> =>
  String(await new Compiler({ output: { collapseNesting: true } }).renderString(less, { language: 'less', suppressWarnings: true }));

/** The argument list `name(…)` is written with in `css`. */
const argsOf = (css: string, name: string): string => {
  const at = css.indexOf(`${name}(`);
  return at === -1 ? css : css.slice(at + name.length, css.indexOf(';', at));
};

describe('owner 2026-10-09: "every CSS function should be evaluating args"', () => {
  it.fails('owner 2026-10-09: "every CSS function should be evaluating args" — `rgb(@a + 1, 2, 3)` is `rgb(11, 2, 3)`', async () => {
    await expect(render('@a: 10; .y { h: rgb(@a + 1, 2, 3); }')).resolves.toBe('.y {\n  h: rgb(11, 2, 3);\n}\n');
  });

  /*
   * A condition argument of a colour call is evaluated as it is in any other CSS
   * function's arguments (`unknown()` here, ledger F11).
   */
  for (const condition of [
    '1 and 2',
    'not ((1 = 1) or (2 = 2))',
    '((1 = 1)) or 2',
    '(1) and (2)',
    '((1) and (2))',
    '1 AND 2',
    'NOT (1 = 1)',
    '@a > 2px',
    '(@a > 2px) and (@a < 5px)',
    'not (@a = 3px)'
  ]) {
    it.fails(`owner 2026-10-09: "every CSS function should be evaluating args" — \`rgb(${condition}, 3, 4)\` reads its argument as unknown() does`, async () => {
      const css = await render(`@a: 3px; .y { a: rgb(${condition}, 3, 4); b: unknown(${condition}, 3, 4); }`);
      expect(argsOf(css, 'rgb')).toBe(argsOf(css, 'unknown'));
    });
  }

  it.fails('owner 2026-10-09: "why is var() special??" — a `var()` fallback evaluates escapes, calls and math', async () => {
    await expect(render('@a: 2px; .y { a: var(--x, e("red")); b: var(--x, (1px + 2px)); c: var(--x, ~"esc"); d: var(--w, @a + 1px); e: var(--x, darken(red, 10%)); }'))
      .resolves.toBe('.y {\n  a: var(--x, red);\n  b: var(--x, 3px);\n  c: var(--x, esc);\n  d: var(--w, 3px);\n  e: var(--x, #cc0000);\n}\n');
  });
});
