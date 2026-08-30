import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { resolveLessTestDataRoot } from '../test-utils.js';

describe('namespaced mixin-call variable values', () => {
  it('retains a nested map call and propagates its call-level importance through accessors', async () => {
    const css = await new Compiler({ compile: { plugins: [lessPlugin()] } }).renderString(`
      #theme.dark.navbar {
        .colors() { primary: rebeccapurple; secondary: lightblue; }
      }
      .card {
        @theme-colors: #theme.dark.navbar.colors() !important;
        background: @theme-colors[primary];
        border-color: @theme-colors[secondary];
      }
    `, { language: 'less' });

    expect(css).toBe(`.card {
  background: rebeccapurple !important;
  border-color: lightblue !important;
}
`);
  });

  it('continues an imported namespace call result through a local accessor', async () => {
    const input = join(
      resolveLessTestDataRoot(),
      'tests-config/namespacing/namespacing-5.less'
    );
    const result = await new Compiler({ compile: { plugins: [lessPlugin()] } })
      .renderToResult(input);

    expect(result.errors).toEqual([]);
    expect(result.css).toContain('background: rebeccapurple !important;');
    expect(result.css).toContain('border: 1px solid lightblue !important;');
  });

  it('keeps successive imported namespace definitions in import insertion order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jess-imported-namespace-order-'));
    try {
      writeFileSync(join(dir, 'first.less'), `
#palette() {
  .value() { color: first; }
}
`);
      writeFileSync(join(dir, 'second.less'), `
#palette() {
  .value() { color: second; }
}
`);
      const entry = join(dir, 'entry.less');
      writeFileSync(entry, `
@import "first";
@import "second";
.result {
  @value: #palette.value();
  color: @value[color];
}
`);

      const compiler = new Compiler({ compile: { plugins: [lessPlugin()] } });
      const parsed = await compiler.createContext(entry).getTree(entry);
      expect(parsed.node?.type).toBe('Stylesheet');
      await expect(compiler.render(entry)).resolves.toBe(`.result {
  color: second;
}
`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
