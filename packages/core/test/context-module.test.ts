import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Context } from '../src/context.js';
import { AbstractPlugin } from '../src/plugin.js';

class ResolverOnlyPlugin extends AbstractPlugin {
  name = 'resolver-only';

  resolveCalls = 0;
  locateCalls = 0;

  override resolve(filePath: string | string[], currentDir: string, searchPaths: string[]): string[] {
    this.resolveCalls++;
    return super.resolve(filePath, currentDir, searchPaths);
  }

  override locate(pathCandidates: string[], currentDir: string): null | string {
    this.locateCalls++;
    return super.locate(pathCandidates, currentDir);
  }
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

class ScriptImportPlugin extends AbstractPlugin {
  name = 'js';
  supportedExtensions = ['.js'];

  importCalls = 0;

  async import(absoluteFilePath: string): Promise<Record<string, any>> {
    this.importCalls++;
    return { loaded: path.basename(absoluteFilePath) };
  }
}

describe('Context.getModule', () => {
  it('does not resolve a bare module without a resolver plugin', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-no-module-fallback-'));
    const moduleDir = path.join(tmpDir, 'node_modules', 'bare-module');
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, 'index.js'), 'export const ok = true;', 'utf8');

    const context = new Context({ searchPaths: [tmpDir] });

    await expect(context.getModule('bare-module')).rejects.toMatchObject({
      code: 'import/not-found',
      phase: 'import',
      reason: `Could not resolve "bare-module" from "${process.cwd()}".`
    });
  });

  it('allows @jesscss/fns imports without plugin-js', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-fns-'));
    const fnsFile = path.join(tmpDir, 'fns.js');
    fs.writeFileSync(fnsFile, 'export const ok = true;', 'utf8');

    const context = new Context({}, [new FnsImportPlugin(fnsFile)]);

    await expect(context.getModule('@jesscss/fns')).resolves.toMatchObject({
      module: { ok: true }
    });
  });

  it('allows #less/#sass aliases without plugin-js', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-fns-alias-'));
    const fnsFile = path.join(tmpDir, 'fns.js');
    fs.writeFileSync(fnsFile, 'export const ok = true;', 'utf8');

    const context = new Context({}, [new FnsImportPlugin(fnsFile)]);

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

  it('loads JSON modules directly without JavaScript execution or plugin-js', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-json-'));
    const jsonFile = path.join(tmpDir, 'tokens.json');
    fs.writeFileSync(jsonFile, JSON.stringify({ color: 'blue', spacing: 4 }), 'utf8');

    let lazyLoads = 0;
    const context = new Context(
      {
        loadPluginForExtension(extension) {
          lazyLoads++;
          throw new Error(`unexpected lazy plugin load for ${extension}`);
        }
      },
      [new ResolverOnlyPlugin()]
    );

    await expect(context.getModule(jsonFile)).resolves.toMatchObject({
      module: {
        default: { color: 'blue', spacing: 4 },
        color: 'blue',
        spacing: 4
      }
    });
    expect(lazyLoads).toBe(0);
  });

  it('loads script importer lazily only after resolving a script module', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-lazy-js-'));
    const scriptFile = path.join(tmpDir, 'module.js');
    fs.writeFileSync(scriptFile, 'export const a = 1;', 'utf8');

    let loads = 0;
    const lazyPlugin = new ScriptImportPlugin();
    const context = new Context(
      {
        loadPluginForExtension(extension) {
          loads++;
          expect(extension).toBe('.js');
          return lazyPlugin;
        }
      },
      [new ResolverOnlyPlugin()]
    );

    expect(context.plugins.map(plugin => plugin.name)).toEqual(['resolver-only']);
    await expect(context.getModule(scriptFile)).resolves.toMatchObject({
      module: { loaded: 'module.js' }
    });
    expect(loads).toBe(1);
    expect(context.plugins.map(plugin => plugin.name)).toEqual(['resolver-only', 'js']);
  });

  it('reuses loaded script modules during one context cycle', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-module-cache-'));
    const scriptFile = path.join(tmpDir, 'module.js');
    fs.writeFileSync(scriptFile, 'export const a = 1;', 'utf8');

    let loads = 0;
    const resolver = new ResolverOnlyPlugin();
    const lazyPlugin = new ScriptImportPlugin();
    const context = new Context(
      {
        loadPluginForExtension(extension) {
          loads++;
          expect(extension).toBe('.js');
          return lazyPlugin;
        }
      },
      [resolver]
    );

    const first = await context.getModule(scriptFile);
    const second = await context.getModule(scriptFile);

    expect(second).toBe(first);
    expect(first).toMatchObject({ module: { loaded: 'module.js' } });
    expect(loads).toBe(1);
    expect(resolver.resolveCalls).toBe(1);
    expect(resolver.locateCalls).toBe(1);
    expect(lazyPlugin.importCalls).toBe(1);
  });

  it('blocks script modules when disableScriptModules is set even if an importer is available', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-disable-js-'));
    const scriptFile = path.join(tmpDir, 'module.js');
    fs.writeFileSync(scriptFile, 'export const a = 1;', 'utf8');

    let loads = 0;
    const context = new Context(
      {
        disableScriptModules: true,
        loadPluginForExtension(extension) {
          loads++;
          return new ScriptImportPlugin();
        }
      },
      [new ResolverOnlyPlugin()]
    );

    await expect(context.getModule(scriptFile)).rejects.toThrow(
      'Script modules are disabled by disableScriptModules.'
    );
    expect(loads).toBe(0);
  });

  it('treats disablePluginRule as a deprecated alias for disableScriptModules', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-core-disable-plugin-rule-'));
    const scriptFile = path.join(tmpDir, 'module.js');
    fs.writeFileSync(scriptFile, 'export const a = 1;', 'utf8');

    let loads = 0;
    const context = new Context(
      {
        disablePluginRule: true,
        loadPluginForExtension(extension) {
          loads++;
          return new ScriptImportPlugin();
        }
      },
      [new ResolverOnlyPlugin()]
    );

    await expect(context.getModule(scriptFile)).rejects.toThrow(
      'Script modules are disabled by disableScriptModules.'
    );
    expect(loads).toBe(0);
  });
});
