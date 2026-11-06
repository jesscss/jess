/**
 * Turn a DIALECT INDEX into a dispatch registry.
 *
 * The registration unit is a dialect's own index module (`less/index.ts`,
 * `sass/index.ts`) — the same module a consumer imports. There is deliberately
 * no assembly array, no merged registry and no cross-dialect fallback: each
 * dialect registers exactly what its index exports, so adding a fn to a dialect
 * folder plus a line in that folder's index is the whole change.
 *
 * The predicate below also keeps non-callable namespace exports out if an index
 * ever grows one, but the dialect callable surfaces themselves are value-domain
 * `Fn`s. There is no legacy tree-node fallback here.
 */
import { createFnRegistry, type Fn, type FnRegistry } from '@jesscss/core/value';

/**
 * Whether a dialect-index export is a value-domain {@link Fn}. The value-domain
 * factory attaches `params` directly to the callable.
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

/**
 * A dialect index's callables as a `.jess` file imports them: the name the
 * registry dispatches a call on (`fn.name`, lowercased) → the index export that
 * `@-from "<module>" import (…)` names. Same derivation as {@link registryOf}.
 */
export function exportNamesByCall(dialectIndex: Readonly<Record<string, unknown>>): Map<string, string> {
  const names = new Map<string, string>();
  for (const [exported, value] of Object.entries(dialectIndex)) {
    if (isFn(value)) {
      names.set(value.name.toLowerCase(), exported);
    }
  }
  return names;
}
