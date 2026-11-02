import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { build } from 'vite';
import jess from '../src/index.js';

type Runtime = { css: string; vars: (values: Record<string, string>) => Record<string, string> };

/** The bundled module, once it is known to export the runtime. */
function isRuntime(module: unknown): module is Runtime {
  return typeof module === 'object' && module !== null && 'vars' in module && typeof module.vars === 'function';
}

describe('vite-plugin-jess', () => {
  it('bundles the CSS and the runtime of a stylesheet that exports variables', async () => {
    const result = await build({
      root: __dirname,
      configFile: false,
      logLevel: 'silent',
      plugins: [jess()],
      build: { write: false, lib: { entry: path.resolve(__dirname, 'main.js'), formats: ['es'], fileName: 'main' } }
    });
    const first = [result].flat()[0];
    const output = first !== undefined && 'output' in first ? first.output : [];
    const css = output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
    expect(css?.type === 'asset' ? String(css.source) : '').toContain('var(--brand-darken,');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-jess-'));
    try {
      const file = path.join(directory, 'main.mjs');
      fs.writeFileSync(file, output[0]?.code ?? '');
      const module: unknown = await import(file);
      expect(isRuntime(module)).toBe(true);
      if (isRuntime(module)) {
        expect(module.css).toContain('var(--brand,');
        // eslint-disable-next-line @typescript-eslint/naming-convention -- custom property names
        expect(module.vars({ brand: '#08f' })).toEqual({ '--brand': '#08f', '--brand-darken': '#006dcc' });
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
