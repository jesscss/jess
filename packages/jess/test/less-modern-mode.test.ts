import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

/**
 * Ledger P36: a `.less` document that writes `@use` or `@compose` is in MODERN
 * MODE. Its Less built-ins are not ambient — a built-in reaches it only by
 * import, and an unimported call is emitted as written, the way `.jess` emits
 * an unimported name (P17). A document with neither is LEGACY and its built-ins
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

  it('modern: an unimported built-in is emitted as written', async () => {
    await expect(less(`@use "#less";\n${BODY}`)).resolves.toBe(
      'a {\n  padding: min(-5px, 1px);\n  color: darken(red, 10%);\n}\n'
    );
  });

  it('modern: an imported built-in computes', async () => {
    await expect(less('@use "#less";\na { color: @less.darken(red, 10%); padding: @less.min(-5px, 1px); }'))
      .resolves.toBe('a {\n  color: #cc0000;\n  padding: -5px;\n}\n');
  });

  it('modern: a directive after the call still decides the document', async () => {
    await expect(less(`${BODY}\n@use "#less";`)).resolves.toBe(
      'a {\n  padding: min(-5px, 1px);\n  color: darken(red, 10%);\n}\n'
    );
  });

  it('modern: a call inside a mixin argument is emitted as written', async () => {
    await expect(less('@use "#less";\n.m(@c) { color: @c; }\n.x { .m(darken(red, 10%)); }'))
      .resolves.toBe('.x {\n  color: darken(red, 10%);\n}\n');
  });

  it('modern: a call in an at-rule prelude is emitted as written', async () => {
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
