import type { Context } from '../../context.js';
import { ExtendRootRegistry } from './extend-roots.js';

const extendRootRegistries = new WeakMap<Context, ExtendRootRegistry>();

/** The extend-root registry for `context`, created on first use. */
export function extendRootsOf(context: Context): ExtendRootRegistry {
  let registry = extendRootRegistries.get(context);
  if (registry === undefined) {
    registry = new ExtendRootRegistry();
    extendRootRegistries.set(context, registry);
  }
  return registry;
}
