import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

/**
 * Ledger P36: a `.less` document that writes `@use` or `@compose` is in MODERN
 * MODE. Its Less built-ins are not ambient — a built-in reaches it only by
 * import, and an unimported call takes the unknown-call path, the way `.jess`
 * treats an unimported name (P17): its name and call shape stay, and its
 * arguments are evaluated like any other value. A document with neither is LEGACY and its built-ins
 * compute as the author asked. The mode is decided per document, and
 * `moduleMode: 'modern'` puts every `.less` document in modern mode.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function project(...files: Array<[name: string, source: string]>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-modern-mode-'));
  tempDirs.push(directory);
  for (const [name, source] of files) {
    fs.writeFileSync(path.join(directory, name), source, 'utf8');
  }
  return directory;
}

/** `#less` is a trusted built-in module; no script runtime is involved. */
function compiler(): Compiler {
  const created = new Compiler();
  created['createJsPluginProxy'] = () => undefined;
  return created;
}

const less = (source: string, moduleMode?: 'auto' | 'modern') => compiler().renderString(source, {
  extension: '.less',
  ...(moduleMode === undefined ? {} : { config: { language: { less: { moduleMode } } } })
});

const BODY = 'a { padding: min(-5px, 1px); color: darken(red, 10%); }';

describe('Less modern mode (P36)', () => {
  it('legacy: a document with no module directive computes its built-ins', async () => {
    await expect(less(BODY)).resolves.toBe('a {\n  padding: -5px;\n  color: #cc0000;\n}\n');
  });

  it('modern: an unimported built-in keeps its name and call shape', async () => {
    await expect(less(`@use "#less";\n${BODY}`)).resolves.toBe(
      'a {\n  padding: min(-5px, 1px);\n  color: darken(red, 10%);\n}\n'
    );
  });

  it('modern: an unimported call still evaluates its arguments', async () => {
    await expect(less('@use "#less";\n@c: red;\n@n: 10%;\na { color: darken(@c, @n * 2); }'))
      .resolves.toBe('a {\n  color: darken(red, 20%);\n}\n');
  });

  it('modern: an imported built-in computes', async () => {
    await expect(less('@use "#less";\na { color: @less.darken(red, 10%); padding: @less.min(-5px, 1px); }'))
      .resolves.toBe('a {\n  color: #cc0000;\n  padding: -5px;\n}\n');
  });

  it.each(['#less', '@jesscss/fns/less'])('modern: `@use "%s"` binds `less` and computes', async (specifier) => {
    await expect(less(`@use "${specifier}";\na { color: @less.darken(red, 10%); padding: min(-5px, 1px); }`))
      .resolves.toBe('a {\n  color: #cc0000;\n  padding: min(-5px, 1px);\n}\n');
  });

  it.each(['#less', '@jesscss/fns/less'])('.jess: `@-use "%s"` binds `$less` and computes', async (specifier) => {
    await expect(compiler().renderString(`@-use "${specifier}";\na { color: $less.darken(red, 10%); }`, { extension: '.jess' }))
      .resolves.toBe('a {\n  color: #cc0000;\n}\n');
  });

  it.each(['#less', '@jesscss/fns/less'])('.jess: `@-from "%s"` binds its import and computes', async (specifier) => {
    await expect(compiler().renderString(`@-from "${specifier}" import (darken);\na { color: darken(red, 10%); }`, { extension: '.jess' }))
      .resolves.toBe('a {\n  color: #cc0000;\n}\n');
  });

  it('modern: a directive after the call still decides the document', async () => {
    await expect(less(`${BODY}\n@use "#less";`)).resolves.toBe(
      'a {\n  padding: min(-5px, 1px);\n  color: darken(red, 10%);\n}\n'
    );
  });

  it('modern: a call inside a mixin argument keeps its call shape', async () => {
    await expect(less('@use "#less";\n.m(@c) { color: @c; }\n.x { .m(darken(red, 10%)); }'))
      .resolves.toBe('.x {\n  color: darken(red, 10%);\n}\n');
  });

  describe('if(), boolean() and each()', () => {
    const VALUES = '@a: 2;\n@l: 1 2;\n';
    const CALLS = 'x { b: if(@a > 1, @a * 1px, 2px); c: boolean(@a > 1); d: if( (@a > 1) ,  1px,2px ); e: each(@l, { v: @a; }); }';

    /*
     * The unknown-call path, not a copy of the source: variables substituted,
     * arithmetic computed, the comparison evaluated like any other argument
     * (ledger V11: a comparison in a call argument evaluates), and a
     * detached-ruleset argument written from its evaluated body (ledger P37,
     * jess#290).
     */
    const EVALUATED = 'x {\n  b: if(true, 2px, 2px);\n  c: boolean(true);\n  d: if(true, 1px, 2px);\n  e: each(1 2, { v: 2; });\n}\n';

    it('legacy: they are lowered into language structure and compute', async () => {
      await expect(less('@a: 2;\n@l: 1 2;\nx { b: if(@a > 1, 1px, 2px); c: boolean(@a > 1); }\n.y { each(@l, { v: @value; }); }'))
        .resolves.toBe('x {\n  b: 1px;\n  c: true;\n}\n.y {\n  v: 1;\n  v: 2;\n}\n');
    });

    it('modern: they are ordinary unimported calls, their arguments evaluated', async () => {
      await expect(less(`@use "#less";\n${VALUES}${CALLS}`)).resolves.toBe(EVALUATED);
    });

    it('modern: they take exactly the path any unknown call takes', async () => {
      const renamed = CALLS.replace(/\b(if|boolean|each)\(/g, 'unknown_$1(');
      const unknown = await less(`@use "#less";\n${VALUES}${renamed}`);
      expect(unknown.replace(/unknown_/g, '')).toBe(EVALUATED);
    });

    it('modern: a directive after the calls still decides the document', async () => {
      await expect(less(`${VALUES}${CALLS}\n@use "#less";`)).resolves.toBe(EVALUATED);
    });

    /* Ledger P37: not lowered, a bare call statement is an eval error, not output. */
    it.each([
      ['each()', '.y { each(@l, { v: @a; }); }'],
      ['if()', '.y { if((true), { color: red; }); }'],
      ['if() at the root', 'if((true), { color: red; });']
    ])('modern: a bare %s statement raises', async (_label, statement) => {
      await expect(less(`@use "#less";\n${VALUES}${statement}`))
        .rejects.toThrow(expect.objectContaining({ code: 'eval/invalid-statement' }));
    });

    /*
     * The unknown-call path drops a keyword argument's name (#279). Until that
     * is fixed these calls lose it exactly as `darken(@color: …)` does, no
     * better and no worse. `each()` has no keyword spelling to compare.
     */
    it('modern: a keyword argument fares exactly as it does on darken() (#279)', async () => {
      await expect(less('@use "#less";\n@a: 2;\n@c: red;\nx { a: darken(@color: @c, 10%); b: if(@k: @a, 2px); c: boolean(@k: @a); }'))
        .resolves.toBe('x {\n  a: darken(red, 10%);\n  b: if(2, 2px);\n  c: boolean(2);\n}\n');
    });
  });

  it('modern: a call in an at-rule prelude keeps its call shape', async () => {
    await expect(less('@use "#less";\n@media screen and round(1.5) { a { b: c; } }'))
      .resolves.toBe('@media screen and round(1.5) {\n  a {\n    b: c;\n  }\n}\n');
  });

  it.each([
    ['@use', '@use "#less";'],
    ['@-use', '@-use "#less";'],
    ['@compose', '@compose "./theme.less";'],
    ['@-compose', '@-compose "./theme.less";'],
    ['a nested @compose', '.wrap { @compose "./theme.less"; }']
  ])('%s switches the document to modern mode', async (_label, directive) => {
    const directory = project(
      ['theme.less', '@gap: 1px;'],
      ['entry.less', `${directive}\na { padding: min(-5px, 1px); }\n`]
    );
    const css = await compiler().render(path.join(directory, 'entry.less'));
    expect(css).toContain('padding: min(-5px, 1px);');
  });

  it('decides the mode per document: a legacy partial computes inside a modern document', async () => {
    const directory = project(
      ['legacy.less', '.legacy { p: min(-5px, 1px); }\n@legacy-color: darken(red, 10%);\n.legacy-mixin() { q: min(-5px, 1px); }\n'],
      ['entry.less', '@use "#less";\n@import "./legacy.less";\n.entry { p: min(-5px, 1px); v: @legacy-color; .legacy-mixin(); }\n']
    );
    await expect(compiler().render(path.join(directory, 'entry.less'))).resolves.toBe(
      '.legacy {\n  p: -5px;\n}\n.entry {\n  p: min(-5px, 1px);\n  v: #cc0000;\n  q: -5px;\n}\n'
    );
  });

  it('decides the mode per document: a modern partial stays modern inside a legacy document', async () => {
    const directory = project(
      ['modern.less', '@use "#less";\n.modern { p: min(-5px, 1px); }\n@modern-color: darken(red, 10%);\n.modern-mixin() { q: min(-5px, 1px); }\n'],
      ['entry.less', '@import "./modern.less";\n.entry { p: min(-5px, 1px); v: @modern-color; .modern-mixin(); }\n']
    );
    await expect(compiler().render(path.join(directory, 'entry.less'))).resolves.toBe(
      '.modern {\n  p: min(-5px, 1px);\n}\n.entry {\n  p: -5px;\n  v: darken(red, 10%);\n  q: min(-5px, 1px);\n}\n'
    );
  });

  describe('moduleMode option', () => {
    it('modern puts a document with no module directive in modern mode', async () => {
      await expect(less(BODY, 'modern')).resolves.toBe(
        'a {\n  padding: min(-5px, 1px);\n  color: darken(red, 10%);\n}\n'
      );
    });

    it('modern still computes an imported built-in', async () => {
      await expect(less('@use "#less";\na { color: @less.darken(red, 10%); }', 'modern'))
        .resolves.toBe('a {\n  color: #cc0000;\n}\n');
    });

    it('auto (the default) changes nothing', async () => {
      await expect(less(BODY, 'auto')).resolves.toBe('a {\n  padding: -5px;\n  color: #cc0000;\n}\n');
    });
  });
});
