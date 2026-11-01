import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeBridgeResult, decodeBridgeValue, encodeBridgeArgs } from '../../src/bridge.js';
import type { ContextualPluginFunction, JsPlugin } from '../../src/index.js';

const probe = { module: pathToFileURL(path.join(path.dirname(new URL(import.meta.url).pathname), 'probe.ts')).href, exportName: 'Probe' };

type Spec = Record<string, unknown> & { kind: string };

/**
 * What a test reaches a script through: the plugin's compile engine, one
 * render per load or call (`probe.ts` is the compiler the engine runs). The
 * read root is the plugin's `jsReadRoot` (else the script's folder), as for a
 * render of an entry there.
 */
export function sandboxed(plugin: JsPlugin, pluginOptions: Record<string, unknown> = {}) {
  const run = (spec: Spec, near: string): Promise<unknown> => {
    const root = plugin.opts.jsReadRoot ?? path.dirname(near);
    return plugin.renderInEngine({
      compiler: probe,
      compilerOptions: {},
      method: 'render',
      args: [{ ...spec, pluginOptions }],
      entryDir: root,
      jsReadRoot: root
    });
  };
  return {
    /* Typed as `JsPlugin.import` is, so tests read exports as they did. */
    async import(modulePath: string): ReturnType<JsPlugin['import']> {
      const exported = await run({ kind: 'exports', modulePath }, modulePath);
      const out: Awaited<ReturnType<JsPlugin['import']>> = {};
      const items: unknown[] = Array.isArray(exported) ? exported : [];
      for (const item of items) {
        const name = String(Reflect.get(Object(item), 'name'));
        const value: unknown = Reflect.get(Object(item), 'value');
        out[name] = Reflect.get(Object(item), 'kind') === 'function'
          ? async (...args: unknown[]) => decodeBridgeValue(await run({ kind: 'invoke', modulePath, exportName: name, args: encodeBridgeArgs(args) }, modulePath))
          : value;
      }
      return out;
    },
    async importLessPlugin(modulePath: string, options: string | null = null): Promise<{ functions: Record<string, ContextualPluginFunction> }> {
      const names = await run({ kind: 'lessPlugin', modulePath, options }, modulePath);
      const functions: Record<string, ContextualPluginFunction> = {};
      for (const functionName of Array.isArray(names) ? names : []) {
        functions[String(functionName)] = async (args?: readonly unknown[] | unknown) => decodeBridgeResult(await run({
          kind: 'lessCall',
          modulePath,
          options,
          functionName,
          args: encodeBridgeArgs(args === undefined ? [] : Array.isArray(args) ? args : [args])
        }, modulePath));
      }
      return { functions };
    }
  };
}
