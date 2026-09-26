import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * Ledger P38: function arguments may be a `;`-separated list of BRANCHES — a
 * condition, a colon, an optional value — in every dialect; css-values-5 §8.3
 * `if()` is the first user. In `.less` a call whose first argument is followed
 * by a top-level `:` takes that shape in legacy and modern mode alike, except
 * a Less keyword argument (`darken(@color: red)`). The `;`s are preserved
 * (owner: *“yes we have to preserve `;` for those declaration forms”*), and
 * values inside branches are evaluated like any Less value. Without the colon
 * shape a call keeps Less's meaning (`foo(a; b)` → two arguments), and a legacy
 * `if(cond, a, b)` is still lowered.
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

describe('Less: branch arguments (P38)', () => {
  for (const [mode, prefix] of MODES) {
    it(`${mode}: CSS if() with style() and else branches is emitted as written`, async () => {
      await expect(render(`${prefix}a { color: if(style(--scheme: dark): white; else: black); }`))
        .resolves.toBe('a {\n  color: if(style(--scheme: dark): white; else: black);\n}\n');
    });

    it(`${mode}: a lone else branch`, async () => {
      await expect(render(`${prefix}a { width: if(else: 1px); }`))
        .resolves.toBe('a {\n  width: if(else: 1px);\n}\n');
    });

    it(`${mode}: the trailing \`;\` is preserved`, async () => {
      await expect(render(`${prefix}a { width: if(media(print): 1px;); }`))
        .resolves.toBe('a {\n  width: if(media(print): 1px;);\n}\n');
    });

    it(`${mode}: variables inside a branch are substituted`, async () => {
      await expect(render(`${prefix}@v: dark;\n@c: white;\na { color: if(style(--scheme: @v): @c; else: black); }`))
        .resolves.toBe('a {\n  color: if(style(--scheme: dark): white; else: black);\n}\n');
    });

    it(`${mode}: media() and supports() tests are query syntax, emitted as written`, async () => {
      await expect(render(`${prefix}a { width: if(media(width > 600px): 10px; supports(display: grid): 5px; else: 0); }`))
        .resolves.toBe('a {\n  width: if(media(width > 600px): 10px; supports(display: grid): 5px; else: 0);\n}\n');
    });

    it(`${mode}: variables inside a media() test are substituted`, async () => {
      await expect(render(`${prefix}@w: 600px;\na { width: if(media(width > @w): 10px; else: 0); }`))
        .resolves.toBe('a {\n  width: if(media(width > 600px): 10px; else: 0);\n}\n');
    });

    it(`${mode}: media()/supports()/style() outside a branch condition are ordinary calls`, async () => {
      await expect(render(`${prefix}@a: x;\na { b: supports(@a) media(@a, 1) style(@a); }`))
        .resolves.toBe('a {\n  b: supports(x) media(x, 1) style(x);\n}\n');
    });

    it(`${mode}: \`foo(a; b)\` keeps Less's meaning, two arguments`, async () => {
      await expect(render(`${prefix}a { b: foo(a; b); }`))
        .resolves.toBe('a {\n  b: foo(a, b);\n}\n');
    });
  }

  it('legacy: a Less keyword argument is not a branch', async () => {
    await expect(render('a { color: darken(@color: red, 10%); }'))
      .resolves.toBe('a {\n  color: #cc0000;\n}\n');
  });

  it('legacy: a comma-shaped if() is still Less\'s lowered conditional', async () => {
    await expect(render('a { color: if((1 > 0), white, black); }'))
      .resolves.toBe('a {\n  color: white;\n}\n');
  });
});
