import { AbstractPlugin, type Context } from '@jesscss/core';
import type { Fn } from '@jesscss/core/value';
import { LessApiBridge, type NativeLessPlugin } from './less-api-bridge.js';

/**
 * Native AST-v2 functions contributed by an application. Function bodies receive
 * typed value objects and the narrow `FnCtx` capability supplied by core; they
 * never receive Less tree nodes or a legacy evaluation context.
 */
export interface LessCompatPluginOptions {
  readonly functions?: readonly Fn[];
  readonly plugins?: readonly NativeLessPlugin[];
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
  private readonly bridges = new WeakMap<Context, LessApiBridge>();

  constructor(public readonly opts: LessCompatPluginOptions = {}) {
    super();
  }

  setContext(context: Context): void {
    let bridge = this.bridges.get(context);
    if (!bridge) {
      bridge = new LessApiBridge(this.opts.plugins ?? []);
      this.bridges.set(context, bridge);
    }
    const bridgeHost = bridge.createPluginHost(({ specifier, options }) => context.getPluginModule(specifier, options));
    const functions = this.opts.functions;
    const host = context.pluginHost;
    const globalFns = [
      ...(host?.globalFns ?? []),
      ...(bridgeHost.globalFns ?? []),
      ...(functions ?? [])
    ];
    context.pluginHost = {
      ...host,
      ...(globalFns.length === 0 ? {} : { globalFns }),
      loadPlugin: bridgeHost.loadPlugin || host?.loadPlugin
        ? (request) => {
            const baseLoaded = host?.loadPlugin?.(request);
            const bridgeLoaded = bridgeHost.loadPlugin?.(request);
            const merge = (baseFns: readonly Fn[] | undefined, bridgeFns: readonly Fn[] | undefined) => [
              ...(baseFns ?? []),
              ...(bridgeFns ?? [])
            ];
            const baseThenable = baseLoaded && typeof baseLoaded === 'object' && 'then' in baseLoaded;
            const bridgeThenable = bridgeLoaded && typeof bridgeLoaded === 'object' && 'then' in bridgeLoaded;
            if (baseThenable || bridgeThenable) {
              return Promise.all([baseLoaded ?? [], bridgeLoaded ?? []]).then(([baseFns, bridgeFns]) => merge(baseFns, bridgeFns));
            }
            return merge(baseLoaded, bridgeLoaded);
          }
        : undefined,
      invokeRawFunction: (fn, args, ctx) =>
        bridgeHost.invokeRawFunction?.(fn, args, ctx) ?? host?.invokeRawFunction?.(fn, args, ctx)
    };
  }
}

const lessCompatPlugin = (opts?: LessCompatPluginOptions) => new LessCompatPlugin(opts);

export default lessCompatPlugin;
export { lessCompatPlugin };
