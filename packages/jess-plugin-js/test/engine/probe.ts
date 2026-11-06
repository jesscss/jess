// @ts-nocheck
/*
 * A stand-in compiler for the plugin-js tests. The compile engine makes it by
 * module identity, as it makes a real compiler, and each `render(spec)` loads
 * or calls one script through the engine's in-process runtime: the same
 * sandbox, flags and runtime a real render uses, with the test driving one
 * script at a time instead of a stylesheet (see `sandboxed.ts`).
 */
import { JsPlugin } from '../../src/index.ts';
import { decodeBridgeValue, encodeBridgeArgs } from '../../src/bridge.ts';
import { invokeExport } from '../../src/plugin-runtime.ts';
import { ERR } from '@jesscss/core';

export class Probe {
  plugins = new Map();

  pluginFor(options) {
    const key = JSON.stringify(options ?? {});
    let plugin = this.plugins.get(key);
    if (!plugin) {
      plugin = new JsPlugin(options ?? {});
      this.plugins.set(key, plugin);
    }
    return plugin;
  }

  async render(spec) {
    const plugin = this.pluginFor(spec.pluginOptions);
    const args = (spec.args ?? []).map(decodeBridgeValue);
    switch (spec.kind) {
      case 'exports': {
        const mod = await plugin.import(spec.modulePath);
        return Object.entries(mod).map(([name, value]) => (typeof value === 'function'
          ? { name, kind: 'function' }
          : { name, kind: 'value', value }));
      }
      case 'invoke':
        /*
         * The runtime call itself, bridged once each way, as a render's call
         * through `JsPlugin` is; a refused tree node is reported as `JsPlugin`
         * reports it.
         */
        return invokeExport(spec.modulePath, spec.exportName, spec.args ?? []).catch((err) => {
          throw err?.name === 'UnsupportedLessPluginApiError'
            ? ERR.pluginUnsupported({ meta: { plugin: spec.modulePath.split('/').pop(), feature: err.message } })
            : err;
        });
      case 'lessPlugin':
        return Object.keys((await plugin.importLessPlugin(spec.modulePath, spec.options ?? null)).functions);
      case 'lessCall': {
        const { functions } = await plugin.importLessPlugin(spec.modulePath, spec.options ?? null);
        return encodeBridgeArgs([await functions[spec.functionName](args)])[0];
      }
      default:
        throw new Error(`Unknown probe "${spec.kind}".`);
    }
  }
}
