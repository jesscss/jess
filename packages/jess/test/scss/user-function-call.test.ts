import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * End-to-end proof that a call to a user SCSS `@function` invokes the binding
 * the grammar made for it.
 *
 * `@function f` lowers at parse to a `$f`-bound value lambda, but the CALL site
 * `f(2)` is left as an ordinary `FunctionCall` — identical in shape to a builtin
 * `darken(...)`. Which one a name denotes is a scope question, so the evaluator
 * answers it with the ordinary lexical lookup rather than the parser answering it
 * with a whole-document scan. These cases pin the resulting behavior, including
 * the two shapes that deliberately do NOT resolve.
 */
describe('SCSS user @function call sites', () => {
  const render = async (src: string): Promise<string> =>
    new Compiler().renderString(src, { extension: '.scss' });

  it('invokes a user function declared before the call', async () => {
    const css = await render('@function double($n) { @return $n * 2; }\n.a { w: double(2); }');
    expect(css).toBe('.a {\n  w: 4;\n}\n');
  });

  it('invokes a zero-parameter user function', async () => {
    const css = await render('@function two() { @return 2; }\n.a { w: two(); }');
    expect(css).toBe('.a {\n  w: 2;\n}\n');
  });

  it('invokes nested user function calls', async () => {
    const css = await render('@function double($n) { @return $n * 2; }\n.a { w: double(double(1)); }');
    expect(css).toBe('.a {\n  w: 4;\n}\n');
  });

  /** A user function SHADOWS the builtin of the same name. */
  it('prefers a user function over a builtin of the same name', async () => {
    const css = await render('@function darken($c, $p) { @return red; }\n.a { c: darken(#fff, 10%); }');
    expect(css).toBe('.a {\n  c: red;\n}\n');
  });

  it('routes an unshadowed builtin call to fns', async () => {
    expect(await render('.a { c: darken(#fff, 10%); }')).toBe('.a {\n  c: #e6e6e6;\n}\n');
  });

  /*
   * Sass hoists function definitions; jess does not yet, and a call preceding its
   * `@function` emits verbatim. This is recorded as the CURRENT behavior, not an
   * endorsement — it was equally true when a parse-time pass collected names from
   * the whole document, because the binding is what a call resolves against and
   * the binding is not active yet.
   */
  it('does not yet resolve a call that precedes its @function', async () => {
    const css = await render('.a { w: double(2); }\n@function double($n) { @return $n * 2; }');
    expect(css).toBe('.a {\n  w: double(2);\n}\n');
  });

  /** A function is only callable where its binding is in scope. */
  it('does not resolve a user function outside the block that defined it', async () => {
    const css = await render('.a { @function loc($n) { @return $n * 3; } }\n.b { w: loc(2); }');
    expect(css).toBe('.b {\n  w: loc(2);\n}\n');
  });
});
