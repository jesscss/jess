import type { Node } from '../node.js';
import { F_STATIC } from '../node.js';

const guardConstantMemo = new WeakMap<Node, boolean>();

/**
 * A `when()` guard is a compile-time constant when nothing in its own subtree
 * needs a per-candidate frame lookup — every node is inert (a literal / keyword),
 * with no reference, call, condition, or other dynamic node. A constant guard is
 * evaluated once (no caller-frame outer-rules surface); a dynamic guard is
 * re-evaluated per candidate against its bound param/caller frame.
 *
 * This is a guard-LOCAL property: the guard owns the answer, computed once and
 * memoized, so the callable machinery asks the guard rather than each site
 * independently inspecting the node flag. A guard is a stable, shared source
 * node, so the memo is safe and stable across candidate evaluations.
 */
export function isConstantGuard(guard: Node): boolean {
  const memoized = guardConstantMemo.get(guard);
  if (memoized !== undefined) {
    return memoized;
  }
  const constant = guard.hasFlag(F_STATIC);
  guardConstantMemo.set(guard, constant);
  return constant;
}
