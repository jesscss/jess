import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('Less import live bindings through the public route', () => {
  it.each([true, false])(
    'publishes a later static import graph\'s facts before output starts (collapse=%s)',
    async (collapseNesting) => {
      const dir = mkdtempSync(join(tmpdir(), 'jess-import-hoisted-facts-'));
      writeFileSync(join(dir, 'tokens.less'), [
        '@tone: blue;',
        '.later() { value: @tone; }',
        ''
      ].join('\n'));
      writeFileSync(join(dir, 'definitions.less'), [
        '@import "tokens";',
        '.imported { order: middle; }',
        ''
      ].join('\n'));
      writeFileSync(join(dir, 'entry.less'), [
        '.before { .later(); color: @tone; }',
        '@import "definitions";',
        '.after { order: last; }',
        ''
      ].join('\n'));

      const css = await new Compiler({
        compile: { plugins: [lessPlugin()] },
        output: { collapseNesting }
      }).render(join(dir, 'entry.less'));

      expect(css).toBe([
        '.before {',
        '  value: blue;',
        '  color: blue;',
        '}',
        '.imported {',
        '  order: middle;',
        '}',
        '.after {',
        '  order: last;',
        '}',
        ''
      ].join('\n'));
    }
  );

  it('makes an imported map declaration available to a later imported each() body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jess-import-live-'));
    writeFileSync(join(dir, 'variables.less'), [
      '@grays: { 100: #f8f9fa; 900: #212529; };',
      '@escaped-characters: { <: %3c; >: %3e; #: %23; (: %28; ): %29; };',
      '@colors: { primary: red; };',
      ''
    ].join('\n'));
    writeFileSync(join(dir, 'root.less'), ':root { each(@colors, #(@value, @name) { color: @value; }); }\n');
    writeFileSync(join(dir, 'entry.less'), '@import "variables";\n@import "root";\n');

    const css = await new Compiler({ compile: { plugins: [lessPlugin()] } })
      .render(join(dir, 'entry.less'));

    expect(css).toContain('color: red');
  });
});
