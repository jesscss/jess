/**
 * A ROOT parentless `&` — the `& when (@flag) { … }` / `& { … }` guard-block idiom
 * that Less ports lean on (bootstrap-less-port wraps `_grid.less` and `_navbar.less`
 * class output in one) — resolves to EMPTY. It is not a selector: it contributes no
 * descendant prefix and no `:is()` arm to the rules nested inside it, which compose
 * as ROOT rules instead.
 *
 * The serializer's `rootStrings` path and the extend IR's `composePath` both project
 * that context and used to disagree — extend composed the un-stripped `& .child`, so
 * an `:extend()` anywhere inside a root guard block leaked a literal `&` into flat
 * CSS. In bootstrap that produced `& .container` and `& :is(…, & .container-sm, …)`;
 * a leaked top-level `&` resolves to `:scope` in Chromium and breaks outright in any
 * engine without CSS Nesting.
 *
 * The bar differs by shape. The `&`-RESOLUTION expectations are plain selector
 * composition, where Less 4.x is a legitimate reference and jess is byte-identical
 * to `lessc` 4.6.3. The EXTEND expectations are not held to that bar: v5 compacts a
 * multi-branch sub-part into `:is(…)` where 4.x cartesian-expands, so `.nav .f` +
 * an `all` extender is `.nav :is(.f, .cs)` here and `.nav .f, .nav .cs` there. Both
 * name the same selector set; only the leak the `&` produced is a defect.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
});

const render = (less: string): Promise<string> =>
  compiler.renderString(less, { extension: '.less' });

describe('root parentless ampersand block', () => {
  it('folds an extender into its target header without a leaked `&`', async () => {
    const css = await render(`
\\%ph { max-width: 5px; }
& when (true) {
  .container-sm { &:extend(\\%ph); }
}
`);

    expect(css).toBe(
      '\\%ph,\n'
      + '.container-sm {\n'
      + '  max-width: 5px;\n'
      + '}\n'
    );
  });

  it('substitutes an `all` extender inside a target branch without a leaked `&`', async () => {
    // The bootstrap `_grid.less` shape: `.container-@{breakpoint} { &:extend(.container-fluid all) }`
    // inside `& when (@enable-grid-classes)`.
    const css = await render(`
.f { width: 100%; }
& when (true) {
  .cs { &:extend(.f all); }
}
.nav .f { color: red; }
`);

    // v5 compacts the extended sub-part; 4.x emits `.nav .f, .nav .cs`. The
    // compaction is the intended output, NOT a divergence to chase back.
    expect(css).toBe(
      '.f,\n'
      + '.cs {\n'
      + '  width: 100%;\n'
      + '}\n'
      + '.nav :is(.f, .cs) {\n'
      + '  color: red;\n'
      + '}\n'
    );
  });

  it('emits a nested rule with no leading descendant space', async () => {
    expect(await render('& when (true) { .a { color: red; } }'))
      .toBe('.a {\n  color: red;\n}\n');
    expect(await render('& { .a { color: red; } }'))
      .toBe('.a {\n  color: red;\n}\n');
    expect(await render('& { .a { .b { color: red; } } }'))
      .toBe('.a .b {\n  color: red;\n}\n');
  });

  it('resolves an inner `&` that the peeled block left parentless', async () => {
    expect(await render('& { &.x { color: red; } }'))
      .toBe('.x {\n  color: red;\n}\n');
    expect(await render('& { & .x { color: red; } }'))
      .toBe('.x {\n  color: red;\n}\n');
    expect(await render('& { .a { & { color: red; } } }'))
      .toBe('.a {\n  color: red;\n}\n');
  });

  it('drops the empty branch from a multi-branch root selector list', async () => {
    expect(await render('&, .p { .a { color: red; } }'))
      .toBe('.p .a {\n  color: red;\n}\n');
  });
});
