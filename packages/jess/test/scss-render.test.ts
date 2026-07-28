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

  /**
   * A user `@function` lowers to a `$var`-bound value lambda (an `AnonymousMixin`
   * carrying `params`); `@return` lowers to a `result:` entry; a call to it lowers
   * to a `$f(args)` invoke. The evaluator binds args→params and yields `result:`.
   */
  it('renders a zero-parameter user @function call', async () => {
    const compiler = new Compiler();
    const src = '@function two() { @return 2; }\n.a { w: two(); }';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('w: 2');
    expect(css).not.toContain('two(');
    expect(css).not.toContain('@function');
  });

  it('renders a parameterized user @function call binding the argument', async () => {
    const compiler = new Compiler();
    const src = '@function double($n) { @return $n * 2; }\n.a { w: double(2); }';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('w: 4');
    expect(css).not.toContain('double(');
    expect(css).not.toContain('@function');
  });

  /**
   * An SCSS map literal lowers to a `Collection`, which reaches an argument
   * position trivially. The value serializer used to fold it to EMPTY bytes while
   * the surrounding comma glue still printed (`foo($m, b)` → `foo(, b)`), silently
   * dropping the argument. A Collection serializes as the canonical Jess
   * collection form — never the Sass paren-map input syntax, which is lowered
   * away at parse.
   */
  it('serializes an SCSS map argument as a Jess collection', async () => {
    const compiler = new Compiler();
    const src = '$m: (a: 1, b: 2);\n.x { y: foo($m, b); }';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('y: foo({ a: 1; b: 2 }, b)');
  });

  it('serializes an inline SCSS map literal in a non-first argument position', async () => {
    const compiler = new Compiler();
    const src = '.x { y: foo(z, (a: 1, b: 2)); }';
    const css = await compiler.renderString(src, { extension: '.scss' });
    expect(css).toContain('y: foo(z, { a: 1; b: 2 })');
  });
});
