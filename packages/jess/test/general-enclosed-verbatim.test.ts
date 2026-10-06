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
    expect(await lessPrelude('@w: x;\n@media foo(@{w}:y)')).toBe('@media foo(x:y)');
  });

  /* The boundary: an ordinary call with an interpolated argument in a feature value is evaluated, as on dev. */
  it('still evaluates an ordinary call with an interpolated argument in a feature value', async () => {
    expect(await lessPrelude('@w: 768px;\n@media (min-width: e("@{w}"))')).toBe('@media (min-width: 768px)');
  });

  it('still evaluates an ordinary call with an interpolated argument in an SCSS feature value', async () => {
    const css = String(await new Compiler().renderString('$w: 768;\n@media (min-width: unquote("#{$w}px")) { a { b: c } }', { extension: '.scss' }));
    expect(css.slice(0, css.indexOf('{')).trimEnd()).toBe('@media (min-width: 768px)');
  });

  /*
   * A variable read inside a media group's general-enclosed contents is a
   * reference, so it resolves and the rest stays as written: dart-sass and
   * lessc 4.9.1 both write `(foo: 1px baz)`.
   */
  it.each([
    ['scss', '$bar: 1px;\n@media (foo: $bar baz)', '@media (foo: 1px baz)'],
    ['scss', '$bar: 1px;\n@media ($bar baz)', '@media (1px baz)'],
    ['scss', '$bar: 1px;\n@media (foo: $bar, baz)', '@media (foo: 1px, baz)'],
    ['less', '@x: 10px;\n@media (foo: @x baz)', '@media (foo: 10px baz)'],
    ['less', '@x: 10px;\n@media (@x baz)', '@media (10px baz)'],
    ['less', '@x: 10px;\n@media (foo: @{x} baz)', '@media (foo: 10px baz)']
  ])('resolves a variable inside a %s media general-enclosed group: %j', async (dialect, source, prelude) => {
    const css = String(await new Compiler().renderString(`${source} { a { b: c } }`, { extension: `.${dialect}` }));
    expect(css.slice(0, css.indexOf('{')).trimEnd()).toBe(prelude);
  });

  it('keeps the name exemption for a defined condition function with an interpolated payload', async () => {
    expect(await lessPrelude('@v: 1;\n@media style(--x:@{v})')).toBe('@media style(--x: 1)');
  });

  it('does not call a Less function named by an interpolated general-enclosed group', async () => {
    expect(await lessPrelude('@w: 50;\n@media percentage(@{w})')).toBe('@media percentage(50)');
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
