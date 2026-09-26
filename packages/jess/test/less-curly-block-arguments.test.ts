import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Ledger P37, CSS `{}` argument wrapping in Less: css-values-5 §3.1.1 lets a
 * free-form argument be wrapped in `{}` so it can carry commas, which collides
 * with Less reading a `{` in a function argument as a detached ruleset. For
 * now a `{` in a Less function argument is a detached ruleset, as it always
 * was, and the `{}`-wrapped value list is "LATER" (pending below). A `var()`
 * fallback is a literal path and keeps `{ a, b }` as written.
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

    /* P37 "LATER": a `{}`-wrapped value list in a Less function argument. */
    it.todo(`${mode}: a dashed function's curly block argument --max-plus-x({ 1px, 7px, 2px }, 3px) is emitted as written (P37 LATER)`);
    it.todo(`${mode}: a curly block foo({ a, b }) is emitted as written (P37 LATER)`);
    it.todo(`${mode}: the values inside a curly block --f({ @x, 1px }, @x) are evaluated (P37 LATER)`);

    it(`${mode}: a declaration list is still a detached ruleset`, async () => {
      await expect(render(`${prefix}.m(@r) { @r(); }\na { .m({ v: 1; }); }`))
        .resolves.toBe('a {\n  v: 1;\n}\n');
    });
  }

  it('legacy: an each() callback is still a detached ruleset', async () => {
    await expect(render('@l: 1, 2;\na { each(@l, { v: @value; }); }'))
      .resolves.toBe('a {\n  v: 1;\n  v: 2;\n}\n');
  });

  it('a branch value may be a detached ruleset, written out as a ruleset argument', async () => {
    await expect(render('a { b: if(c: { v: 1; }); }'))
      .resolves.toBe('a {\n  b: if(c: { v: 1; });\n}\n');
  });
});
