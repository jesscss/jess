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
function installError(plugin: NativeLessPlugin): JessError {
  try {
    new LessApiBridge([plugin]);
  } catch (error) {
    if (error instanceof JessError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the plugin install to be refused');
}

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
  ['pluginManager.addPreProcessor()', (_less, manager) => manager.addPreProcessor({}), 'before'],
  ['pluginManager.addPostProcessor()', (_less, manager) => manager.addPostProcessor({}), 'output.compress'],
  ['pluginManager.addFileManager()', (_less, manager) => manager.addFileManager({}), '@jesscss/plugin-node-modules'],

  /* 4.x plugins reach these before the hook call (`new less.visitors.Visitor(this)`). */
  ['less.visitors', less => Reflect.get(less, 'visitors'), 'visitor'],
  ['less.FileManager', less => Reflect.get(less, 'FileManager'), '@jesscss/plugin-node-modules'],
  ['less.environment', less => Reflect.get(less, 'environment'), '@jesscss/plugin-node-modules']
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
    expect(refused.message).toContain('Plugin "unnamed"');
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

  it('surfaces the refusal from the opt-in compat plugin', () => {
    const plugin = new LessCompatPlugin({
      plugins: [{ name: 'visitor-plugin', install: (_less, manager) => manager.addVisitor({}) }]
    });
    expect(() => plugin.setContext(new Context({}, []))).toThrow(JessError);
  });
});
