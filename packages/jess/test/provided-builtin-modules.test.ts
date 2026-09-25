import { describe, expect, it } from 'vitest';
import { Context, type PluginInterface } from '@jesscss/core';
import { LessPlugin } from '@jesscss/plugin-less';
import { NodeModulesPlugin } from '@jesscss/plugin-node-modules';
import { ScssPlugin } from '@jesscss/plugin-scss';

/**
 * `#less` and `#sass/*` are private module paths their DIALECT PLUGINS provide:
 * each is an alias of a `@jesscss/fns` package module, resolved, loaded and
 * trusted by the plugin that owns the dialect. A generic resolver provides none
 * of them, and the package spelling reaching the same file is the same module.
 */
const nodeModules = () => new NodeModulesPlugin({ basePath: process.cwd() });

function loader(context: Context, resolvedPath: string): PluginInterface | undefined {
  return context.plugins.find(plugin => plugin.import && plugin.canImportModule?.(resolvedPath) === true);
}

describe.each([
  { alias: '#less', pkg: '@jesscss/fns/less', member: 'lighten', provider: () => new LessPlugin() },
  { alias: '#sass/math', pkg: '@jesscss/fns/sass/math', member: 'abs', provider: () => new ScssPlugin() }
])('$alias', ({ alias, pkg, member, provider }) => {
  it('does not resolve without the dialect plugin that provides it', async () => {
    const context = new Context({}, [nodeModules()]);
    await expect(context.getModule(alias)).rejects.toThrow(/not found/i);
  });

  it('leaves the package spelling resolving as an ordinary package', async () => {
    const context = new Context({}, [nodeModules()]);
    await expect(context.resolveImportPath(pkg)).resolves.toMatchObject({
      resolvedPath: expect.stringContaining('fns')
    });
  });

  it('loads the alias and the package spelling as one module, trusted by its provider', async () => {
    const plugin = provider();
    const context = new Context({}, [nodeModules(), plugin]);

    const direct = await context.getModule(pkg);
    const aliased = await context.getModule(alias);
    expect(aliased.resolvedPath).toBe(direct.resolvedPath);
    expect(aliased.module).toBe(direct.module);
    expect(aliased.module).toMatchObject({ [member]: expect.any(Function) });
    expect(loader(context, aliased.resolvedPath)).toBe(plugin);
  });
});
