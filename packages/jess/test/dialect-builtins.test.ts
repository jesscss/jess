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
    // Sass has no converted `unit()` yet, so the call is not a Less answer.
    expect(String(scss)).not.toContain('b: 10;');
  });

  it('keeps the two registries disjoint where the dialects disagree', () => {
    const lessNames = new Set(lessFns.map(fn => fn.name));
    const sassNames = new Set(sassFns.map(fn => fn.name));

    // Less-specific fns must not leak into Sass.
    for (const lessOnly of ['lighten', 'darken', 'fadein', 'greyscale', 'argb', 'unit']) {
      expect(sassNames.has(lessOnly)).toBe(false);
    }
    // Sass list fns must not leak into Less.
    for (const sassOnly of ['nth', 'append', 'zip', 'is-bracketed']) {
      expect(lessNames.has(sassOnly)).toBe(false);
    }
    // `length` exists in both, from each dialect's own implementation.
    expect(lessNames.has('length')).toBe(true);
    expect(sassNames.has('length')).toBe(true);
    expect(lessFns.find(fn => fn.name === 'length'))
      .not.toBe(sassFns.find(fn => fn.name === 'length'));
  });

  it('registers only what a dialect index exports', () => {
    // A legacy (unconverted) export is reachable as a module member but is not a
    // built-in. `each` is exported by `less/index.ts` and must stay unregistered.
    expect(lessFns.some(fn => fn.name === 'each')).toBe(false);
    // Sass's unconverted globals likewise register nothing.
    expect(sassFns.some(fn => fn.name === 'unit')).toBe(false);
    expect(sassFns.some(fn => fn.name === 'quote')).toBe(false);
  });
});
