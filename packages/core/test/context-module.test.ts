import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Context } from '../src/context.js';
import { AbstractPlugin } from '../src/plugin.js';

class ResolverOnlyPlugin extends AbstractPlugin {
  name = 'resolver-only';
}

class FnsImportPlugin extends AbstractPlugin {
  name = 'js';
  supportedExtensions = ['.js'];

  constructor(private readonly fnsFilePath: string) {
    super();
  }

  override resolve(filePath: string | string[]) {
    const values = Array.isArray(filePath) ? filePath : [filePath];
    if (
      values.includes('@jesscss/fns')
      || values.includes('#less')
      || values.includes('#sass')
      || values.includes('#less/math')
      || values.includes('#sass/map')
    ) {
      return [this.fnsFilePath];
    }
    return values;
  }

  async import(absoluteFilePath: string): Promise<Record<string, any>> {
    if (absoluteFilePath === this.fnsFilePath) {
      return { ok: true };
    }
    throw new Error('unexpected import path');
  }
}

describe('Context.getModule', () => {
  it('allows @jesscss/fns imports when enableJavaScript is false', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-fns-'));
    const fnsFile = path.join(tmpDir, 'fns.js');
    fs.writeFileSync(fnsFile, 'export const ok = true;', 'utf8');

    const context = new Context(
      { enableJavaScript: false },
      [new FnsImportPlugin(fnsFile)]
    );

    await expect(context.getModule('@jesscss/fns')).resolves.toMatchObject({
      module: { ok: true }
    });
  });

  it('allows #less/#sass aliases when enableJavaScript is false', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-fns-alias-'));
    const fnsFile = path.join(tmpDir, 'fns.js');
    fs.writeFileSync(fnsFile, 'export const ok = true;', 'utf8');

    const context = new Context(
      { enableJavaScript: false },
      [new FnsImportPlugin(fnsFile)]
    );

    await expect(context.getModule('#less')).resolves.toMatchObject({ module: { ok: true } });
    await expect(context.getModule('#sass')).resolves.toMatchObject({ module: { ok: true } });
    await expect(context.getModule('#less/math')).resolves.toMatchObject({ module: { ok: true } });
    await expect(context.getModule('#sass/map')).resolves.toMatchObject({ module: { ok: true } });
  });

  it('suggests plugin-js for unsupported script files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-js-'));
    const scriptFile = path.join(tmpDir, 'module.js');
    fs.writeFileSync(scriptFile, 'export const a = 1;', 'utf8');

    const context = new Context({}, [new ResolverOnlyPlugin()]);
    await expect(context.getModule(scriptFile)).rejects.toThrow(
      'Feature not supported. Install @jesscss/plugin-js to enable script execution features.'
    );
  });
});
