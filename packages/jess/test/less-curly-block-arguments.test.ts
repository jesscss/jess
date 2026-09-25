import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Ledger P37, CSS `{}` argument wrapping in Less: css-values-5 §3.1.1 lets a
 * free-form argument be wrapped in `{}` so it can carry commas, which collides
 * with Less reading a `{` in a function argument as a detached ruleset. The
 * owner: *“i meant for output, we should output as-is”*, and a `{` is a CURLY
 * BLOCK or a DECLARATION LIST, decided by the block's first item — a value makes
 * it a curly block (*“a curly block can just have one or more comma-separated
 * values”*), a declaration, nested rule or mixin call a detached ruleset.
 *
 * Both modes: the mode (P36) decides function scope, not how a `{` parses.
 */

/** `#less` is a trusted built-in module; no script runtime is involved. */
function compiler(): Compiler {
  const created = new Compiler();
  created['createJsPluginProxy'] = () => undefined;
  return created;
}

const MODES: Array<[string, string]> = [
  ['legacy', ''],
  ['modern', '@use "#less";\n']
];

const render = (source: string) => compiler().renderString(source, { extension: '.less' });

describe('Less: a `{` in a function argument (P37)', () => {
  for (const [mode, prefix] of MODES) {
    it(`${mode}: a var() fallback curly block is emitted as written`, async () => {
      await expect(render(`${prefix}a { color: var(--x, { a, b }); }`))
        .resolves.toBe('a {\n  color: var(--x, { a, b });\n}\n');
    });

    it(`${mode}: a dashed function's curly block argument is emitted as written`, async () => {
      await expect(render(`${prefix}a { width: --max-plus-x({ 1px, 7px, 2px }, 3px); }`))
        .resolves.toBe('a {\n  width: --max-plus-x({ 1px, 7px, 2px }, 3px);\n}\n');
    });

    it(`${mode}: a one-value curly block is a curly block`, async () => {
      await expect(render(`${prefix}a { b: foo({ a }); }`))
        .resolves.toBe('a {\n  b: foo({ a });\n}\n');
    });

    it(`${mode}: the values inside a curly block are evaluated`, async () => {
      await expect(render(`${prefix}@x: 5px;\na { width: --f({ @x, 1px }, @x); }`))
        .resolves.toBe('a {\n  width: --f({ 5px, 1px }, 5px);\n}\n');
    });

    it(`${mode}: a declaration list is still a detached ruleset`, async () => {
      await expect(render(`${prefix}.m(@r) { @r(); }\na { .m({ v: 1; }); }`))
        .resolves.toBe('a {\n  v: 1;\n}\n');
    });
  }

  it('legacy: an each() callback is still a detached ruleset', async () => {
    await expect(render('@l: 1, 2;\na { each(@l, { v: @value; }); }'))
      .resolves.toBe('a {\n  v: 1;\n  v: 2;\n}\n');
  });

  /*
   * A lone function call with no `;` is a value first, so it is a curly block —
   * on origin/dev it was a detached ruleset holding one call statement. No
   * corpus input has this shape. A lone MIXIN or DETACHED-RULESET call is the
   * opposite: it starts a statement, so the block is a declaration list (pinned
   * in less-parser `brace-arguments.test.ts`).
   */
  it('a lone function call with no `;` is a curly block', async () => {
    await expect(render('a { b: foo({ f(x) }); }'))
      .resolves.toBe('a {\n  b: foo({ f(x) });\n}\n');
  });

  it('a block whose first value is not followed by `,` or `}` is neither shape', async () => {
    await expect(render('a { b: foo({ a; b }); }')).rejects.toThrow();
  });
});
