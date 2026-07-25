import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * `min()`/`max()` per dialect. There is no single shared body, and that is the
 * point: each namespace does one language's job.
 *
 *   `#less`      lessc semantics — coerce unitless into the reference unit,
 *                compare canonically.        max(1px, 1in, 2) → 1in
 *   `#sass/math` dart-sass semantics, fold artifacts included — a unitless
 *                operand compares on display numbers, no conversion.
 *                                            max(1px, 1in, 2) → 2
 *   `#jess`      CSS-faithful (same <type>, no unitless-vs-length coercion).
 *                NOT YET IMPLEMENTED — needs the namespace machinery, so
 *                `.jess` currently takes the Less set.
 *
 * A failing call is never suppressed by the function. The engine preserves it
 * verbatim in bare position under the default `functionMode: 'preserve'` and
 * reports it under `'error'` — sass-spec § `min.hrx global/README.md` states
 * that split for Sass, and the owner's call-form rule generalises it.
 */

const DIALECTS = ['.less', '.scss', '.jess'] as const;

const render = async (compiler: Compiler, expr: string, extension: string): Promise<string> => {
  const output = await compiler.renderString(`a { b: ${expr}; }`, { extension, suppressWarnings: true });
  const matched = /b:\s*([^;]*);/.exec(String(output));
  if (!matched) {
    throw new Error(`No declaration in output for ${expr} (${extension})`);
  }
  return matched[1]!.trim();
};

/** Where both languages agree — verified against lessc 4.8.0 AND dart-sass 1.101.0. */
const AGREED: Array<[string, string]> = [
  ['max(1px, 2px)', '2px'],
  ['max(1px, 1in)', '1in'],
  ['min(1cm, 3mm)', '3mm'],
  ['max(3em, 1em, 2em, 5em)', '5em'],
  ['min(2px, 1)', '1'],
  ['min(3, 1cm)', '1cm'],
  ['max(3, 1cm)', '3'],
  ['max(1, 2px)', '2px'],
  ['min(1px, 2px, 3)', '1px'],
  ['max(1px, 2px, 3)', '3'],
  ['min(1%, 2, 3%)', '1%'],
  ['max(1%, 2, 3%)', '3%'],
  ['max(1px)', '1px'],
  // Both fail → the engine preserves, in both languages.
  ['max(1px, 2em)', 'max(1px, 2em)'],
  ['min(1px, 2s)', 'min(1px, 2s)'],
  ['min(a, b)', 'min(a, b)'],
  ['min()', 'min()'],
  ['min(1px, var(--x))', 'min(1px, var(--x))']
];

/** Where the languages genuinely differ: `[expression, Less, Sass]`. */
const DIVERGENT: Array<[string, string, string]> = [
  // Less coerces 2 → 2px, so 1in (96px) wins. Sass compares 1, 1, 2 and takes 2.
  ['max(1px, 1in, 2)', '1in', '2'],
  // The dart-sass fold artifact: min succeeds because its running winner goes
  // unitless immediately; max keeps 6em and then meets 4ex. Less fails both —
  // its reference unit stays em throughout.
  ['min(6em, 5, 4ex)', 'min(6em, 5, 4ex)', '4ex'],
  ['min(6em, 5, 4ex, 3, 2pt, 1)', 'min(6em, 5, 4ex, 3, 2pt, 1)', '1'],
  ['max(6em, 5, 4ex, 3, 2pt, 1)', 'max(6em, 5, 4ex, 3, 2pt, 1)', 'max(6em, 5, 4ex, 3, 2pt, 1)']
];

describe('min()/max() per dialect', () => {
  const compiler = new Compiler();

  it.each(AGREED)('%s → %s in every dialect', async (expr, expected) => {
    for (const extension of DIALECTS) {
      expect(await render(compiler, expr, extension), `${expr} in ${extension}`).toBe(expected);
    }
  });

  it.each(DIVERGENT)('%s → %s in Less, %s in Sass', async (expr, lessExpected, sassExpected) => {
    expect(await render(compiler, expr, '.scss'), `${expr} in .scss`).toBe(sassExpected);

    // `.jess` has no dialect fns of its own yet and takes the Less set.
    for (const extension of ['.less', '.jess']) {
      expect(await render(compiler, expr, extension), `${expr} in ${extension}`).toBe(lessExpected);
    }
  });
});

describe('functionMode reaches min()/max()', () => {
  const strict = new Compiler({ compile: { functionMode: 'error' } });

  it('reports a failing call instead of preserving it', async () => {
    for (const extension of DIALECTS) {
      await expect(
        strict.renderString('a { b: max(1px, 2em); }', { extension, suppressWarnings: true })
      ).rejects.toThrow();
    }
  });

  it('still reduces a succeeding call', async () => {
    for (const extension of DIALECTS) {
      expect(await render(strict, 'max(1px, 2px)', extension)).toBe('2px');
    }
  });
});
