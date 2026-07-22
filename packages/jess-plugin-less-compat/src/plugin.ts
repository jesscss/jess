import { AbstractPlugin, type Context } from '@jesscss/core';
import type { Fn } from '@jesscss/core/value';

/**
 * Native AST-v2 functions contributed by an application. Function bodies receive
 * typed value objects and the narrow `FnCtx` capability supplied by core; they
 * never receive Less tree nodes or a legacy evaluation context.
 */
export interface LessCompatPluginOptions {
  readonly functions?: readonly Fn[];
}

/**
 * Transitional package boundary for applications that previously installed the
 * Less compatibility plugin. It contributes only native AST-v2 `Fn` values.
 *
 * Less 4 visitor hooks, `functionRegistry` callbacks, and `@plugin` script
 * execution were legacy tree-runtime APIs. They are intentionally unsupported
 * on the public AST-v2 compiler route: preserving them would require a second
 * evaluator and Node-to-Less/ Less-to-Node conversion bridge.
 */
export class LessCompatPlugin extends AbstractPlugin {
  name = 'less-compat';

  constructor(public readonly opts: LessCompatPluginOptions = {}) {
    super();
  }

  setContext(context: Context): void {
    const functions = this.opts.functions;
    if (!functions || functions.length === 0) {
      return;
    }
    const host = context.pluginHost;
    context.pluginHost = {
      ...host,
      globalFns: [...(host?.globalFns ?? []), ...functions]
    };
  }
}

const lessCompatPlugin = (opts?: LessCompatPluginOptions) => new LessCompatPlugin(opts);

export default lessCompatPlugin;
export { lessCompatPlugin };
