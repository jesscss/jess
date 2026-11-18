/**
 * An imported stylesheet is parsed in the dialect of its own extension, whatever
 * the importing file's dialect and whichever import spelling loads it, except a
 * Less import of a `.css` target: `(less)` on any target, or `@-import` of a
 * `.css` one, reads it as Less (ledger A21).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Renders `entry.<entryExt>`, whose source imports `./theme.<themeExt>` holding `theme`. */
async function render(entryExt: string, entry: string, themeExt: string, theme: string): Promise<string> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-import-dialect-'));
  tempDirs.push(directory);
  fs.writeFileSync(path.join(directory, `theme.${themeExt}`), theme, 'utf8');
  fs.writeFileSync(path.join(directory, `entry.${entryExt}`), entry, 'utf8');
  const compiler = new Compiler();
  try {
    return await compiler.render(path.join(directory, `entry.${entryExt}`));
  } finally {
    compiler.dispose();
  }
}

const THEME: Record<string, string> = {
  jess: '$brand: red;\n.button { color: $brand; }\n',
  less: '@brand: red;\n.button { color: @brand; }\n',

  /* Less evaluates `1px + 2px`; CSS keeps it as written, so the output names the parser. */
  css: '.button { color: red; margin: 1px + 2px; }\n'
};
const BUTTON = '.button {\n  color: red;\n}\n';
const BUTTON_CSS = '.button {\n  color: red;\n  margin: 1px + 2px;\n}\n';
const BUTTON_LESS = '.button {\n  color: red;\n  margin: 3px;\n}\n';

describe('an imported stylesheet is parsed by its own extension', () => {
  it.each([
    ['jess', '@-import', 'jess'],
    ['jess', '@-import', 'less'],
    ['less', '@import', 'jess'],
    ['less', '@-import', 'jess'],
    ['less', '@-import', 'less'],
    ['scss', '@import', 'jess'],
    ['scss', '@import', 'less'],
    ['jess', '@-compose', 'jess'],
    ['jess', '@-compose', 'less'],
    ['less', '@compose', 'jess'],
    ['less', '@-compose', 'jess']
  ])('.%s %s .%s', async (entryExt, name, themeExt) => {
    await expect(render(entryExt, `${name} "./theme.${themeExt}";\n`, themeExt, THEME[themeExt]!)).resolves.toBe(BUTTON);
  });

  /* `@-import` is a clear signal the import is not a CSS `@import`, so it reads a `.css` target as Less. */
  it.each(['jess', 'less'])('.%s @-import .css reads it as Less', async (entryExt) => {
    await expect(render(entryExt, '@-import "./theme.css";\n', 'css', THEME.css!)).resolves.toBe(BUTTON_LESS);
  });

  it.each([
    ['jess', '@-compose'],
    ['less', '@compose']
  ])('.%s %s .css reads it as CSS', async (entryExt, name) => {
    await expect(render(entryExt, `${name} "./theme.css";\n`, 'css', THEME.css!)).resolves.toBe(BUTTON_CSS);
  });

  it('reads an imported .jess binding from the importing .jess file', async () => {
    await expect(render(
      'jess',
      '@-import "./theme.jess";\n.card { color: $brand; padding: $(2 * $gap); }\n',
      'jess',
      '$brand: rebeccapurple;\n$gap: 4px;\n'
    )).resolves.toBe('.card {\n  color: rebeccapurple;\n  padding: 8px;\n}\n');
  });

  it.each(['@import', '@-import'])('still parses a %s (less) import as Less whatever its extension', async (name) => {
    await expect(render('less', `${name} (less) "./theme.css";\n`, 'css', THEME.less!)).resolves.toBe(BUTTON);
  });
});
