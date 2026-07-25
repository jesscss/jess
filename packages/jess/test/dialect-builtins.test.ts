import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';
import { lessFns, sassFns } from '@jesscss/fns';

/**
 * Each dialect gets its OWN built-in function set.
 *
 * Regression guard for the collapse this replaced: one registry was built at
 * module scope from the Less set and assigned to every render, so a `.scss`
 * source was served Less's `unit()` (`unit(10px)` → `10`, where Sass answers
 * with the unit). Dialect never reached the evaluator at all.
 *
 * The invariant is narrow and deliberate: a dialect registers exactly what its
 * own index in `@jesscss/fns` exports. A Sass global that has not been written
 * yet is therefore ABSENT — it must never fall back to the Less implementation.
 */
describe('per-dialect built-ins', () => {
  it('does not serve `.scss` the Less `unit()`', async () => {
    const compiler = new Compiler();
    const less = await compiler.renderString('a { b: unit(10px); }', { extension: '.less' });
    const scss = await compiler.renderString('a { b: unit(10px); }', { extension: '.scss' });

    // Less `unit()` strips the unit.
    expect(String(less)).toContain('b: 10;');
    // Sass `unit()` returns the unit as a quoted string.
    expect(String(scss)).toContain('b: "px";');
  });

  it('keeps the two registries disjoint where the dialects disagree', () => {
    const lessNames = new Set(lessFns.map(fn => fn.name));
    const sassNames = new Set(sassFns.map(fn => fn.name));

    // Less-specific fns must not leak into Sass.
    for (const lessOnly of ['lighten', 'darken', 'fadein', 'greyscale', 'argb']) {
      expect(sassNames.has(lessOnly)).toBe(false);
    }
    // Sass list fns must not leak into Less.
    for (const sassOnly of ['nth', 'append', 'zip', 'is-bracketed', 'comparable', 'type-of']) {
      expect(lessNames.has(sassOnly)).toBe(false);
    }
    // A name the dialects DISAGREE on resolves to each dialect's OWN body —
    // never one shared entry. `unit` is the load-bearing case: Less strips the
    // unit and returns a number, Sass returns the unit as a quoted string.
    for (const divergent of ['length', 'unit', 'percentage']) {
      expect(lessNames.has(divergent)).toBe(true);
      expect(sassNames.has(divergent)).toBe(true);
      expect(lessFns.find(fn => fn.name === divergent))
        .not.toBe(sassFns.find(fn => fn.name === divergent));
    }

    // `min`/`max` are divergent too, and subtly so — the dialects agree on most
    // inputs. Less coerces a unitless argument into the reference unit and
    // compares canonically; Sass compares display numbers. `max(1px, 1in, 2)`
    // is `1in` in Less and `2` in Sass (see `min-max-dialect.test.ts`).
    for (const divergent of ['min', 'max']) {
      expect(lessNames.has(divergent)).toBe(true);
      expect(sassNames.has(divergent)).toBe(true);
      expect(lessFns.find(fn => fn.name === divergent))
        .not.toBe(sassFns.find(fn => fn.name === divergent));
    }
  });

  it('registers only what a dialect index exports', () => {
    // A legacy (unconverted) export is reachable as a module member but is not a
    // built-in. `each` is exported by `less/index.ts` and must stay unregistered.
    expect(lessFns.some(fn => fn.name === 'each')).toBe(false);
    // Sass's still-unconverted globals likewise register nothing.
    expect(sassFns.some(fn => fn.name === 'quote')).toBe(false);
    expect(sassFns.some(fn => fn.name === 'unquote')).toBe(false);
  });
});
