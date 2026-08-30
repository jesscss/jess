import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

/*
 * A `name=value` function argument is a key/value PAIR, not an equality
 * comparison. Reading it as a comparison collapsed every one of these to
 * `false` — silent wrong output with no diagnostic. Expectations are lessc
 * 4.8.1's, except where noted.
 */
const render = async (source: string): Promise<string> =>
  await new Compiler({ output: { collapseNesting: true } }).renderString(
    source,
    { language: 'less', filePath: '/virtual/assignment.less' }
  );

describe('Less `name=value` call arguments', () => {
  it('preserves an assignment argument verbatim', async () => {
    expect(await render('.x { filter: alpha(opacity=50); }'))
      .toBe('.x {\n  filter: alpha(opacity=50);\n}\n');
  });

  it('is generic, not IE-filter specific', async () => {
    expect(await render('.x { a: foo(bar=1); }')).toBe('.x {\n  a: foo(bar=1);\n}\n');
  });

  it('preserves several assignment arguments in one call', async () => {
    expect(await render('.x { a: foo(bar=1, baz=2); }'))
      .toBe('.x {\n  a: foo(bar=1, baz=2);\n}\n');
  });

  it('canonicalizes the authored gap around `=` away', async () => {
    expect(await render('.x { a: foo(bar = 1); }')).toBe('.x {\n  a: foo(bar=1);\n}\n');
  });

  /*
   * DIVERGES FROM lessc 4.8.1, deliberately. Under §12.3 row 2 the pair is no
   * longer a structured node with a live value — it is verbatim bytes — so `@v`
   * is not resolved. The construct is dropped from Less v5 and resolving inside
   * it has no utility, which is the whole reason `Assignment` was deleted.
   */
  it('does NOT evaluate the assigned value', async () => {
    expect(await render('@v: 50; .x { a: foo(bar=@v); }'))
      .toBe('.x {\n  a: foo(bar=@v);\n}\n');
  });

  it('keeps a quoted assigned value quoted', async () => {
    expect(await render('.x { a: foo(bar="a b"); }'))
      .toBe('.x {\n  a: foo(bar="a b");\n}\n');
  });

  /*
   * The two forms split on SHAPE, not on the function name: an assignment key is
   * a bare identifier, so a comparison against a numeric or variable left operand
   * still reaches the condition grammar and still evaluates to a boolean.
   */
  it('leaves a comparison with a non-identifier left operand a comparison', async () => {
    expect(await render('.x { a: boolean(3 = 4); }')).toBe('.x {\n  a: false;\n}\n');
    expect(await render('@v: 1; .x { a: boolean(@v = 1); }')).toBe('.x {\n  a: true;\n}\n');
  });
});
