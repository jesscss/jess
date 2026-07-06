import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

// End-to-end (parse + eval + serialize) repros for the css-3 fixture regressions:
//  - pseudo functional args (`:not(.one)`, `:nth-child(4n+1)`) were dropped under
//    the Less grammar (collapsed selector string / nth leaf skipped by readPseudoArg).
//  - `unicode-range` tokens (`U+0???`, `U+0-7F`) were split into arithmetic.
//  - `@-x-document url-prefix(...)` rendered a spurious space before `(`.
//  - a multi-token comma-list value (`box-shadow`) lost its authored newline.
const c = new Compiler();
async function render(src: string): Promise<string> {
  const css = await c.renderString(src, { language: 'less', config: { output: { compress: false } } as any });
  return typeof css === 'string' ? css : (css as { css: string }).css;
}

describe('css-3 regressions', () => {
  it('keeps the :not() selector argument', async () => {
    expect(await render('input:not(.one) { color: inherit; }'))
      .toBe('input:not(.one) {\n  color: inherit;\n}\n');
  });

  it('keeps the :nth-child() functional argument', async () => {
    expect(await render('li:nth-child(4n+1) { color: inherit; }'))
      .toBe('li:nth-child(4n+1) {\n  color: inherit;\n}\n');
  });

  it('keeps unicode-range tokens intact', async () => {
    expect(await render('@font-face { unicode-range: U+??????, U+0???, U+0-7F, U+A5; }'))
      .toBe('@font-face {\n  unicode-range: U+??????, U+0???, U+0-7F, U+A5;\n}\n');
  });

  it('attaches url-prefix() to a vendor-prefixed at-rule with no space', async () => {
    expect(await render('@-x-document url-prefix("g") { h1 { color: red; } }'))
      .toBe('@-x-document url-prefix("g") {\n  h1 {\n    color: red;\n  }\n}\n');
  });

  it('preserves an authored newline in a multi-token comma-list value', async () => {
    expect(await render('.c {\n  -moz-box-shadow: 0pt 0pt 2px red inset,\n    0pt 4px 6px yellow inset;\n}'))
      .toBe('.c {\n  -moz-box-shadow: 0pt 0pt 2px red inset,\n    0pt 4px 6px yellow inset;\n}\n');
  });
});
