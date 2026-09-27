import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * `<general-enclosed>` (media-queries-4 §3.1) is emitted as written and never
 * evaluated, also in a dialect whose render carries an evaluator. Less reads a
 * `@supports` general-enclosed group as text today (jess#315 tracks the dialects
 * that do not yet share css's structure); either way no `calc()` folding, no
 * function evaluation and no `url()` rewrite reaches inside it (ledger N8).
 */
async function lessPrelude(source: string): Promise<string> {
  const css = String(await new Compiler().renderString(`${source} { a { b: c } }`, { extension: '.less' }));
  return css.slice(0, css.indexOf('{')).trimEnd();
}

describe('Less: general-enclosed is emitted as written and never evaluated', () => {
  for (const source of [
    '@supports (foo(x) calc(1px + 1px))',
    '@supports (foo(url(a/b.png)) bar)',
    '@supports (foo(x)   bar)',
    '@supports (foo(x) /* c */ darken(red, 10%))'
  ]) {
    it(`emits ${source} as written`, async () => {
      expect(await lessPrelude(source)).toBe(source);
    });
  }

  it('still evaluates math in a @supports feature beside it, so the evaluator is live in the prelude', async () => {
    expect(await lessPrelude('@supports (width: (1px + 1px)) and (foo(x) calc(1px + 1px))'))
      .toBe('@supports (width: 2px) and (foo(x) calc(1px + 1px))');
  });
});
