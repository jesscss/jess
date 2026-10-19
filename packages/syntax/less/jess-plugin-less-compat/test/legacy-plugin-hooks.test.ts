import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Context, JessError } from '@jesscss/core';
import {
  LessApiBridge,
  type NativeLessApi,
  type NativeLessPlugin,
  type NativeLessPluginManager
} from '../src/less-api-bridge.js';
import { LessCompatPlugin } from '../src/plugin.js';

/*
 * The Less 4 plugin-manager hook ABI is a deliberate v5 non-goal: a plugin
 * that reaches for it must fail with a diagnostic that names the API and its
 * native replacement, never with a bare TypeError or a silently dropped hook.
 */
function refusalOf(run: () => unknown): JessError {
  try {
    run();
  } catch (error) {
    if (error instanceof JessError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a plugin/unsupported-feature refusal');
}

const installError = (...plugins: NativeLessPlugin[]): JessError =>
  refusalOf(() => new LessApiBridge(plugins));

const isNativeLessPlugin = (value: unknown): value is NativeLessPlugin =>
  typeof value === 'object' && value !== null && 'install' in value && typeof value.install === 'function';

/** Instantiates one of the real 4.x plugins installed as devDependencies. */
function realPlugin(specifier: string): NativeLessPlugin {
  const Plugin: unknown = createRequire(import.meta.url)(specifier);
  if (typeof Plugin !== 'function') {
    throw new Error(`${specifier} does not export a plugin constructor`);
  }
  const instance: unknown = Reflect.construct(Plugin, []);
  if (!isNativeLessPlugin(instance)) {
    throw new Error(`${specifier} did not construct a plugin`);
  }
  return instance;
}

type HookUse = (less: NativeLessApi, manager: NativeLessPluginManager) => unknown;

const hookCases: Array<[string, HookUse, string]> = [
  ['pluginManager.addVisitor()', (_less, manager) => manager.addVisitor({}), 'visitor'],
  ['pluginManager.getVisitors()', (_less, manager) => manager.getVisitors(), 'visitor'],
  ['pluginManager.visitor()', (_less, manager) => manager.visitor(), 'visitor'],
  ['pluginManager.visitors', (_less, manager) => manager.visitors, 'visitor'],
  ['pluginManager.iterator', (_less, manager) => manager.iterator, 'visitor'],
  ['pluginManager.addPreProcessor()', (_less, manager) => manager.addPreProcessor({}), 'before'],
  ['pluginManager.getPreProcessors()', (_less, manager) => manager.getPreProcessors(), 'before'],
  ['pluginManager.preProcessors', (_less, manager) => manager.preProcessors, 'before'],
  ['pluginManager.addPostProcessor()', (_less, manager) => manager.addPostProcessor({}), 'output.compress'],
  ['pluginManager.getPostProcessors()', (_less, manager) => manager.getPostProcessors(), 'output.compress'],
  ['pluginManager.postProcessors', (_less, manager) => manager.postProcessors, 'output.compress'],
  ['pluginManager.addFileManager()', (_less, manager) => manager.addFileManager({}), '@jesscss/plugin-node-modules'],
  ['pluginManager.getFileManagers()', (_less, manager) => manager.getFileManagers(), '@jesscss/plugin-node-modules'],
  ['pluginManager.fileManagers', (_less, manager) => manager.fileManagers, '@jesscss/plugin-node-modules'],
  ['pluginManager.Loader', (_less, manager) => manager.Loader, 'pluginManager.addPlugin()'],

  /* 4.x plugins reach these before the hook call (`new less.visitors.Visitor(this)`). */
  ['less.visitors', less => Reflect.get(less, 'visitors'), 'visitor'],
  ['less.FileManager', less => Reflect.get(less, 'FileManager'), '@jesscss/plugin-node-modules'],
  ['less.environment', less => Reflect.get(less, 'environment'), '@jesscss/plugin-node-modules'],

  /* A tree node beyond the function-plugin value surface (A12), as a constructor or its 4.x factory. */
  ['tree.AtRule', less => Reflect.get(less.tree, 'AtRule'), 'statements, not values'],
  ['tree.AtRule', less => Reflect.get(less, 'atrule'), 'statements, not values'],
  ['tree.Selector', less => Reflect.get(less, 'selector'), 'write the rest in the stylesheet']
];

describe('legacy Less plugin-manager hooks', () => {
  it.each(hookCases)('refuses %s with plugin/unsupported-feature naming the replacement', (feature, use, replacement) => {
    const refused = installError({
      name: 'probe-plugin',
      install(less, manager) {
        use(less, manager);
      }
    });
    expect(refused.code).toBe('plugin/unsupported-feature');
    expect(refused.phase).toBe('plugin');
    expect(refused.message).toContain('probe-plugin');
    expect(refused.message).toContain(feature);
    expect(refused.fix).toContain(replacement);
  });

  it('names a class-based plugin by its constructor', () => {
    class LessPluginMinify {
      install(_less: NativeLessApi, manager: NativeLessPluginManager) {
        manager.addPostProcessor({});
      }
    }
    expect(installError(new LessPluginMinify()).message).toContain('LessPluginMinify');
  });

  it('refuses the real less-plugin-clean-css and points at output.compress', () => {
    const refused = installError(realPlugin('less-plugin-clean-css'));

    /* Its prototype is a plain object literal, so no class name survives. */
    expect(refused.message).toContain('Plugin "plugins[0]"');
    expect(refused.message).toContain('pluginManager.addPostProcessor()');
    expect(refused.fix).toContain('output.compress');
  });

  it('refuses the real less-plugin-autoprefix and points at running the tool on the CSS', () => {
    const refused = installError(realPlugin('less-plugin-autoprefix'));
    expect(refused.message).toContain('pluginManager.addPostProcessor()');
    expect(refused.fix).toContain('PostCSS');
  });

  it('still installs a function-only plugin', () => {
    const bridge = new LessApiBridge([{
      install(_less, _manager, functions) {
        functions.add('one', () => 1);
      }
    }]);
    expect(bridge.globalFns).toHaveLength(1);
  });

  it('installs a plugin with no constructor (an ESM namespace, Object.create(null))', () => {
    const plugin: NativeLessPlugin = {
      install(_less, _manager, functions) {
        functions.add('one', () => 1);
      }
    };
    Object.setPrototypeOf(plugin, null);
    expect(new LessApiBridge([plugin]).globalFns).toHaveLength(1);
  });

  it('names a plugin with neither a name nor a class by its position in plugins', () => {
    const refused = installError(
      { name: 'functions-only', install: (_less, _manager, functions) => functions.add('one', () => 1) },
      { install: (_less, manager) => manager.addVisitor({}) }
    );
    expect(refused.message).toContain('Plugin "plugins[1]"');
  });

  it('names the plugin whose function reads a refused member after install', () => {
    const bridge = new LessApiBridge([
      {
        name: 'late-reader',
        install(less, _manager, functions) {
          functions.add('late', () => Reflect.get(less, 'visitors'));
        }
      },
      { name: 'installed-last', install: () => undefined }
    ]);
    expect(refusalOf(() => bridge.registry.get('late')?.()).message)
      .toContain('Plugin "late-reader" uses less.visitors');
  });

  it('installs function plugins through pluginManager.addPlugin() and addPlugins(), as 4.x does', () => {
    const child = (name: string): NativeLessPlugin => ({
      name,
      install: (_less, _manager, functions) => functions.add(name, () => 1)
    });
    const viaAddPlugin = child('via-add-plugin');
    let manager: NativeLessPluginManager | undefined;
    const bridge = new LessApiBridge([{
      name: 'parent',
      install(_less, pluginManager) {
        manager = pluginManager;
        pluginManager.addPlugin(viaAddPlugin, 'child.js');
        pluginManager.addPlugins([child('first'), child('second')]);
        pluginManager.addPlugins(undefined);
      }
    }]);

    expect(bridge.registry.get('via-add-plugin')).toBeTypeOf('function');
    expect(bridge.registry.get('first')).toBeTypeOf('function');
    expect(bridge.registry.get('second')).toBeTypeOf('function');
    expect(manager?.get('child.js')).toBe(viaAddPlugin);
    expect(manager?.get('missing.js')).toBeUndefined();
    expect(manager?.installedPlugins.map(plugin => plugin.name)).toEqual(['parent', 'via-add-plugin', 'first', 'second']);
    expect(manager?.less.functions.functionRegistry).toBe(bridge.registry);
  });

  it('installs from any array-like passed to pluginManager.addPlugins(), as 4.x does', () => {
    const bridge = new LessApiBridge([{
      install(_less, manager) {
        manager.addPlugins({ length: 1, 0: { install: (_l, _m, functions) => functions.add('array-like', () => 1) } });
      }
    }]);
    expect(bridge.registry.get('array-like')).toBeTypeOf('function');
  });

  it('lets a plugin spread or serialize its manager without tripping the refused fields', () => {
    let keys: string[] = [];
    new LessApiBridge([{
      install(_less, manager) {
        keys = Object.keys({ ...manager });
        JSON.stringify(manager);
      }
    }]);
    expect(keys).toEqual(expect.arrayContaining(['less', 'installedPlugins', 'pluginCache', 'addPlugin']));
    expect(keys).not.toContain('visitors');
  });

  it('installs into the functionRegistry passed to pluginManager.addPlugin()', () => {
    const added: string[] = [];
    const scoped = {
      add: (name: string) => {
        added.push(name);
      },
      addMultiple: () => undefined,
      get: () => undefined
    };
    const bridge = new LessApiBridge([{
      install(_less, manager) {
        manager.addPlugin({ install: (_l, _m, functions) => functions.add('scoped', () => 1) }, undefined, scoped);
      }
    }]);
    expect(added).toEqual(['scoped']);
    expect(bridge.globalFns).toHaveLength(0);
  });

  it('names the configured plugin when a plugin it added reaches for a refused hook', () => {
    const refused = installError({
      name: 'bundle',
      install: (_less, manager) => manager.addPlugin({ install: (_l, inner) => inner.addVisitor({}) })
    });
    expect(refused.message).toBe('Plugin "bundle" uses pluginManager.addVisitor(), which is not supported');
  });

  it('surfaces the refusal from the opt-in compat plugin', () => {
    const plugin = new LessCompatPlugin({
      plugins: [{ name: 'visitor-plugin', install: (_less, manager) => manager.addVisitor({}) }]
    });
    expect(() => plugin.setContext(new Context({}, []))).toThrow(JessError);
  });
});
