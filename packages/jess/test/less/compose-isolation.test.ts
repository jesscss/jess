/**
 * compose-isolation.test.ts — `@compose`/`@use` module isolation (spec R6 Part E).
 *
 * Two axes, both source→CSS through the full Less pipeline:
 *   1. NON-TRANSITIVITY. `@compose` loads a module in its own isolated frame, so the
 *      module's OWN `@compose`/`@import` stay local — a grandparent CANNOT reach a
 *      grandchild's members. `@import` stays transitively leaky (unchanged).
 *   2. `as`-CONTROLLED ACCESS. A plain `@compose "foo.less"` auto-derives `@foo` from
 *      the specifier; `as ns` binds `@ns`; `as *` merges members unqualified. Members
 *      are reached through the forward member-access chain (`@foo.colors.primary`).
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

const fixtures = path.join(__dirname, 'fixtures', 'compose-isolation');

async function renderResult(entry: string, source: string): Promise<{ css: string; errors: { reason?: string }[] }> {
  const file = path.join(fixtures, entry);
  await fs.writeFile(file, source);
  const compiler = new Compiler({ output: { collapseNesting: true }, compile: { plugins: [lessPlugin()] } });
  const result = await compiler.renderToResult(file);
  return { css: result.css.trim(), errors: (result as { errors?: { reason?: string }[] }).errors ?? [] };
}

async function render(entry: string, source: string): Promise<string> {
  return (await renderResult(entry, source)).css;
}

describe('@compose module isolation', () => {
  it('resolves the owner example: @foo.colors.primary through the auto-derived namespace', async () => {
    const css = await render('__owner.less',
      '@compose "foo.less";\n.box { color: @foo.colors.primary; }\n');

    // foo.less renders its own rule; the box reads foo's nested colors.primary.
    expect(css).toContain('.box {\n  color: #3366ff;\n}');
    expect(css).toContain('.foo-rule');
  });

  it('binds an explicit `as ns` namespace', async () => {
    const css = await render('__asns.less',
      '@compose "foo.less" as brand;\n.box { color: @brand.colors.primary; width: @brand.gap; }\n');
    expect(css).toContain('.box {\n  color: #3366ff;\n  width: 8px;\n}');
  });

  it('merges members unqualified with `as *`', async () => {
    const css = await render('__asstar.less',
      '@compose "foo.less" as *;\n.box { color: @colors.primary; width: @gap; }\n');
    expect(css).toContain('.box {\n  color: #3366ff;\n  width: 8px;\n}');
  });

  it('does NOT bind the namespace under `as *` (members are unqualified only)', async () => {
    const css = await render('__asstar-ns.less',
      '@compose "foo.less" as *;\n.box { color: @foo.colors.primary; }\n');

    // @foo is unbound, so the reference survives verbatim rather than resolving.
    expect(css).toContain('@foo.colors.primary');
  });

  it('is non-transitive: a grandparent cannot reach a grandchild member', async () => {
    const css = await render('__nontrans.less',
      '@compose "child-compose.less";\n.box { a: @child-compose.mid; }\n');

    // The child's own member resolves.
    expect(css).toContain('.box {\n  a: green;\n}');

    /*
     * The grandchild's member is NOT exposed through the child namespace:
     * `@child-compose` is bound, yet `.deep` is undefined in scope.
     */
    const deep = await renderResult('__nontrans2.less',
      '@compose "child-compose.less";\n.box { a: @child-compose.deep; }\n');
    expect(deep.css).not.toContain('rebeccapurple');
    expect(deep.errors.some(d => (d.reason ?? '').includes('"deep" is undefined'))).toBe(true);
  });

  it('CONTRAST: @import stays transitive — a grandchild member leaks up', async () => {
    const css = await render('__trans.less',
      '@import "child-import.less";\n.box { a: @deep; b: @mid; }\n');
    expect(css).toContain('.box {\n  a: rebeccapurple;\n  b: green;\n}');
  });
});
