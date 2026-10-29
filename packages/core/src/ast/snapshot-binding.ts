/**
 * What an eagerly snapshotted binding carries beside its bytes.
 *
 * An argument bound by eager snapshot (a `@function` or `@mixin` parameter, a
 * module configuration value) is opaque bytes with the typed value it was
 * evaluated to carried beside it (serialize.ts `carrySnapshot`, and
 * `snapshotPreparedMixinValue` for the structured values a function or plugin
 * receives). These are the reads of those carriers.
 *
 * HARD MODULE BOUNDARY: types from the AST and the value domain, values from
 * the collection domain only.
 */
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { CallValue } from './nodes.js';
import { isCollection } from './value-collection.js';
import type { ValueGroup } from './value-eval.js';

/** The structured values an activation, or the render until one takes them, holds for its snapshots. */
interface SnapshotCarriers {
  readonly mixinValueBindings: ReadonlyMap<CallValue, ValueGroup> | null | undefined;
  readonly mixinUrlBindings: ReadonlyMap<CallValue, ValueGroup> | null | undefined;
}

/** What this reads from the render session. */
export interface SnapshotSession extends SnapshotCarriers {
  readonly snapshotValues: WeakMap<CallValue, ValueGroup> | undefined;
}

/** A variable read's result, as far as this reads one. */
export interface SnapshotHit {
  readonly value: CallValue;
  evaluated: ValueGroup | null;
}

/**
 * Give a variable read the map its snapshot binding carries. A map has no byte
 * form a reader can take items or members from, so the read takes the map, as
 * a read of the variable it came from would: `@each` iterates its entries, a
 * member read finds its keys, a function receives the map. The hit is the
 * read's own result object, so it is filled in place.
 */
export function carriedMap<H extends SnapshotHit>(s: SnapshotSession, hit: H | undefined): H | undefined {
  if (hit?.evaluated !== null || isValueSlotArray(hit.value) || hit.value.type !== 'Any') {
    return hit;
  }
  const carried = s.snapshotValues?.get(hit.value);
  if (carried !== undefined && isCollection(carried)) {
    hit.evaluated = carried;
  }
  return hit;
}

/**
 * The typed value a mixin argument's byte snapshot kept beside it: `'value'` for
 * its evaluated value, `'url'` for a URL-bearing one. The activation that bound
 * the argument holds it; until an activation takes it, the render does.
 */
export function snapshotOf(
  node: CallValue,
  frame: { readonly activation: SnapshotCarriers | null } | null | undefined,
  e: { readonly s: SnapshotSession },
  kind: 'value' | 'url'
): ValueGroup | undefined {
  return kind === 'value'
    ? frame?.activation?.mixinValueBindings?.get(node) ?? e.s.mixinValueBindings?.get(node)
    : frame?.activation?.mixinUrlBindings?.get(node) ?? e.s.mixinUrlBindings?.get(node);
}
