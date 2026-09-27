import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

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
    '@supports (foo(x) /* c */ darken(red, 10%))',
    '@media foo(x:y)'
  ]) {
    it(`emits ${source} as written`, async () => {
      expect(await lessPrelude(source)).toBe(source);
    });
  }

  /* P16: the dialect's own interpolation inside general-enclosed is still evaluated. */
  it('evaluates @{…} interpolation inside general-enclosed and keeps the rest as written', async () => {
    expect(await lessPrelude('@w: x;\n@supports (foo(@{w})   bar)')).toBe('@supports (foo(x)   bar)');
  });

  it('does not rewrite a url() inside general-enclosed while rewriting one outside it (ledger N8, N14)', async () => {
    const css = String(await new Compiler({
      compile: { plugins: [lessPlugin({ rootpath: 'root/' })] }
    }).renderString('@supports (foo(url(a/b.png)) bar) { a { b: url(c.png); } }', { language: 'less' }));
    expect(css).toContain('@supports (foo(url(a/b.png)) bar)');
    expect(css).toContain('url(root/c.png)');
  });

  it('still evaluates math in a @supports feature beside it, so the evaluator is live in the prelude', async () => {
    expect(await lessPrelude('@supports (width: (1px + 1px)) and (foo(x) calc(1px + 1px))'))
      .toBe('@supports (width: 2px) and (foo(x) calc(1px + 1px))');
  });
});
