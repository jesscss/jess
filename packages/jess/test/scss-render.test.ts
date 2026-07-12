import { describe, it, expect } from 'vitest';
import { Compiler } from '../src/index.js';
import scssPlugin from '@jesscss/plugin-scss';

/**
 * End-to-end coverage for the SCSS plugin: parse → eval → render to CSS.
 *
 * Regression guard for the root-rule casing bug — the plugin invoked
 * `parser.parse(source, 'stylesheet', …)` but the functional grammar's root
 * rule is `Stylesheet`, so `grammar['stylesheet']` was undefined and every
 * render threw "Cannot read properties of undefined (reading 'parse')". The
 * scss-parser tests are parse-only and never exercised this path.
 */
describe('scss plugin render-through', () => {
  it('renders `.scss` out of the box (default plugin, no config)', async () => {
    const compiler = new Compiler();
    const css = await compiler.renderString('.a { color: red; }', { extension: '.scss' });
    expect(css).toContain('.a');
    expect(css).toContain('color: red');
  });

  it('renders nested SCSS selectors by default', async () => {
    // Nesting is preserved (the scss plugin defaults collapseNesting to false).
    const compiler = new Compiler();
    const src = '.card { color: blue; .title { font-weight: bold; } }';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('.card');
    expect(css).toContain('color: blue');
    expect(css).toContain('.title');
    expect(css).toContain('font-weight: bold');
  });

  it('honors an explicitly configured scss plugin', async () => {
    const compiler = new Compiler({
      compile: { plugins: [scssPlugin()] }
    });
    const css = await compiler.renderString('.a { color: red; }', { extension: '.scss' });
    expect(css).toContain('color: red');
  });

  /**
   * Regression guard for the Condition-chain trivia thinning (bisected to
   * `e025d2691`, repaired by grammar-level trivia in #85). The parser must
   * hand the eval path a real `@if`/`@else` Condition chain with an evaluable
   * comparison — not the raw `@if`/`@else` at-rules verbatim. Without this
   * gate the scss-parser suite stayed green while the product mis-compiled.
   */
  it('evaluates an `@if`/`@else` comparison — true branch', async () => {
    const compiler = new Compiler();
    const src = '$a: 1;\n.x {\n  @if $a == 1 { color: red; } @else { color: blue; }\n}';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('color: red');
    expect(css).not.toContain('color: blue');
    expect(css).not.toContain('@if');
    expect(css).not.toContain('@else');
  });

  it('evaluates an `@if`/`@else` comparison — false branch', async () => {
    const compiler = new Compiler();
    const src = '$a: 2;\n.x {\n  @if $a == 1 { color: red; } @else { color: blue; }\n}';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('color: blue');
    expect(css).not.toContain('color: red');
    expect(css).not.toContain('@if');
    expect(css).not.toContain('@else');
  });
});
