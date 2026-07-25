/**
 * Turn a DIALECT INDEX into a dispatch registry.
 *
 * The registration unit is a dialect's own index module (`less/index.ts`,
 * `sass/index.ts`) — the same module a consumer imports. There is deliberately
 * no assembly array, no merged registry and no cross-dialect fallback: each
 * dialect registers exactly what its index exports, so adding a fn to a dialect
 * folder plus a line in that folder's index is the whole change.
 *
 * A dialect index may still export modules that have not been converted to the
 * value domain (legacy tree-node callables). Those are not `Fn`s, so they are
 * skipped here rather than listed somewhere as an exception — converting one in
 * place is what registers it.
 */
import { createFnRegistry, type Fn, type FnRegistry } from '@jesscss/core/value';

/**
 * Whether a dialect-index export is a value-domain {@link Fn}. The value-domain
 * factory attaches `params` directly to the callable; the legacy tree-node
 * factory attaches `options`/`_internal` instead and never a bare `params`.
 */
function isFn(value: unknown): value is Fn {
  if (typeof value !== 'function') {
    return false;
  }
  return 'params' in value && Array.isArray(value.params);
}

/** Every value-domain fn a dialect index exports, in export order. */
export function fnsOf(dialectIndex: Readonly<Record<string, unknown>>): Fn[] {
  return Object.values(dialectIndex).filter(isFn);
}

/** Build a registry populated from a dialect index's exports. */
export function registryOf(dialectIndex: Readonly<Record<string, unknown>>): FnRegistry {
  const registry = createFnRegistry();
  registry.registerAll(fnsOf(dialectIndex));
  return registry;
}
