/**
 * Clean-room tree2 mixin GUARD model + evaluation. (rung: guards)
 *
 * HARD MODULE BOUNDARY: this file lives under `tree2/` and therefore imports
 * NOTHING from the legacy tree module. A guard is tree2's OWN structural node set;
 * the only value MATH it delegates is the LEAF condition truth (comparison /
 * type-check function) — handed to the injected `ValueService` as an
 * already-resolved source string, exactly mirroring the rung-8 value seam
 * (tree2 owns STRUCTURE + operand byte emission, the service owns the MATH).
 *
 * tree2 owns the whole boolean STRUCTURE:
 *   - `and` / `or` are combined here (over leaf booleans),
 *   - `not` negates here,
 *   - truthiness (`when (@a)`, `when (true)`) is a pure byte test here
 *     (Less: a bare value guard is true iff it evaluates to the keyword `true`),
 *   - `default()` is a DISPATCH decision tree2 owns (true iff no other def
 *     matched), supplied to `evalGuard` as a callback.
 * Only `cmp` (a comparison like `@a > 0`) and `call` (a boolean function like
 * `iscolor(@a)`) reach the service.
 *
 * Determinism note: `and`/`or` are evaluated WITHOUT short-circuit so that a
 * record pass visits every leaf (guards have no side effects, so this is
 * semantically identical to short-circuiting). This keeps the async
 * record/replay key set for the value service complete.
 */

import type { ValueNode } from './nodes.js';
import type { EvalModes, ListVal, ValueEvaluator, ValueObj } from './value-eval.js';

/** A guard condition tree. Never serialized to CSS — evaluated to a boolean. */
export type GuardNode =
  | { readonly g: 'cmp'; readonly op: string; readonly left: ValueNode; readonly right: ValueNode }
  | { readonly g: 'and'; readonly left: GuardNode; readonly right: GuardNode }
  | { readonly g: 'or'; readonly left: GuardNode; readonly right: GuardNode }
  | { readonly g: 'not'; readonly inner: GuardNode }
  | { readonly g: 'truth'; readonly value: ValueNode }
  | { readonly g: 'call'; readonly name: string; readonly args: ValueNode[] }
  | { readonly g: 'default' };

/** Resolve a value node to its (variable-resolved, un-evaluated) source bytes. */
export type ValueResolver = (v: ValueNode) => string;

/** [R2] Resolve a value node to a materialized TYPED value object. */
export type TypedResolver = (v: ValueNode) => ValueObj;

export interface GuardEvalDeps {
  /** Byte resolver (truthiness). */
  resolve: ValueResolver;
  /** [R2] Typed resolver (comparison / type-fn leaves compare typed values). */
  resolveTyped: TypedResolver;
  ev: ValueEvaluator | null;
  modes: EvalModes;
  /** True iff no non-default definition matched (the `default()` value). */
  isDefault: () => boolean;
}

/**
 * [R2] Evaluate a guard tree to a boolean. Leaf comparisons/type-functions are
 * delegated to the TYPED value evaluator (`guardCmp`/`guardCall`) over
 * materialized value objects — real Less semantics by construction; logic/
 * negation/truthiness/default are owned here.
 */
export function evalGuard(node: GuardNode, deps: GuardEvalDeps): boolean {
  switch (node.g) {
    case 'and': {
      const l = evalGuard(node.left, deps);
      const r = evalGuard(node.right, deps);
      return l && r;
    }
    case 'or': {
      const l = evalGuard(node.left, deps);
      const r = evalGuard(node.right, deps);
      return l || r;
    }
    case 'not':
      return !evalGuard(node.inner, deps);
    case 'truth':
      // Less: a bare-value guard is true only if it evaluates to `true`.
      return deps.resolve(node.value).trim() === 'true';
    case 'cmp': {
      if (!deps.ev) return false;
      const left = deps.resolveTyped(node.left);
      const right = deps.resolveTyped(node.right);
      return deps.ev.guardCmp(node.op, left, right, deps.modes);
    }
    case 'call': {
      if (!deps.ev) return false;
      const items = node.args.map((a) => deps.resolveTyped(a));
      const list: ListVal = { kind: 'list', items, sep: ',', bytes: '' };
      return deps.ev.guardCall(node.name, list, deps.modes);
    }
    case 'default':
      return deps.isDefault();
  }
}

/** Whether a guard tree references `default()` anywhere (a default candidate). */
export function guardUsesDefault(node: GuardNode | undefined): boolean {
  if (!node) return false;
  switch (node.g) {
    case 'default':
      return true;
    case 'and':
    case 'or':
      return guardUsesDefault(node.left) || guardUsesDefault(node.right);
    case 'not':
      return guardUsesDefault(node.inner);
    default:
      return false;
  }
}
