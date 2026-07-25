import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('Less import live bindings through the public route', () => {
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
