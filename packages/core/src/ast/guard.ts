/**
 * Clean-room mixin GUARD model + evaluation.
 *
 * BOUNDARY-CLEAN: this module imports NOTHING from the legacy `../tree`. A guard
 * is this engine's OWN structural node set; the only value MATH it delegates is
 * the LEAF condition truth (comparison / type-check function) — handed to the
 * injected value evaluator as an already-resolved source string (this module owns
 * STRUCTURE + operand byte emission, the evaluator owns the MATH).
 *
 * This module owns the whole boolean STRUCTURE:
 *   - `and` / `or` are combined here (over leaf booleans),
 *   - `not` negates here,
 *   - truthiness (`when (@a)`, `when (true)`) is a pure byte test here
 *     (Less: a bare value guard is true iff it evaluates to the keyword `true`),
 *   - `default()` is a DISPATCH decision owned here (true iff no other def
 *     matched), supplied to `evalGuard` as a callback.
 * Only `cmp` (a comparison like `@a > 0`) and `call` (a boolean function like
 * `iscolor(@a)`) reach the evaluator.
 */

import type { ValueSlot } from './nodes.js';
import { emitValue, type EvalModes, type ValueEvaluator, type ValueGroup } from './value-eval.js';
import { makeList } from './value-factory.js';

/** A guard condition tree. Never serialized to CSS — evaluated to a boolean. */
export type GuardNode =
  | { readonly g: 'cmp'; readonly op: string; readonly left: ValueSlot; readonly right: ValueSlot }
  | { readonly g: 'and'; readonly left: GuardNode; readonly right: GuardNode }
  | { readonly g: 'or'; readonly left: GuardNode; readonly right: GuardNode }
  | { readonly g: 'not'; readonly inner: GuardNode }
  | { readonly g: 'truth'; readonly value: ValueSlot }
  | { readonly g: 'call'; readonly name: string; readonly args: ValueSlot[] }
  | { readonly g: 'default' };

/** Resolve a value node to its (variable-resolved, un-evaluated) source bytes. */
export type ValueResolver = (v: ValueSlot) => string;

/** Resolve a value node to a materialized TYPED value object. */
export type TypedResolver = (v: ValueSlot) => ValueGroup;

export interface GuardEvalDeps {
  /** Typed resolver (comparison / type-fn leaves compare typed values). */
  resolveTyped: TypedResolver;
  ev: ValueEvaluator | null;
  modes: EvalModes;
  /** True iff no non-default definition matched (the `default()` value). */
  isDefault: () => boolean;
}

/**
 * Evaluate a guard tree to a boolean. Leaf comparisons/type-functions are
 * delegated to the TYPED value evaluator (`compare`/`typeCheck`) over
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
      return emitValue(deps.resolveTyped(node.value)).trim() === 'true';
    case 'cmp': {
      if (!deps.ev) {
        return false;
      }
      const left = deps.resolveTyped(node.left);
      const right = deps.resolveTyped(node.right);
      return deps.ev.compare(node.op, left, right, deps.modes);
    }
    case 'call': {
      if (!deps.ev) {
        return false;
      }
      const items = node.args.map(a => deps.resolveTyped(a));
      return deps.ev.typeCheck(node.name, makeList(items, ','), deps.modes);
    }
    case 'default':
      return deps.isDefault();
  }
}

/** Whether a VALUE node references `default()` — a `default()` call anywhere in the
 *  operand expression (`@x = default()` compares `@x` against the dispatch decision).
 *  Recurses the structural value shapes an operand can take so a nested/parenthesized
 *  `default()` is still detected. */
function valueUsesDefault(v: ValueSlot): boolean {
  if (!('type' in v)) {
    return v.some(valueUsesDefault);
  }
  switch (v.type) {
    case 'FunctionCall':
      return v.name.toLowerCase() === 'default' || v.args.some(valueUsesDefault);
    case 'Block':
      return valueUsesDefault(v.inner);
    case 'Operation':
      return valueUsesDefault(v.left) || valueUsesDefault(v.right);
    case 'Sequence':
    case 'SpacedValue':
      return v.parts.some(valueUsesDefault);
    case 'List':
      return v.value.some(valueUsesDefault);
    default:
      return false;
  }
}

/** Whether a guard tree references `default()` anywhere (a default candidate) —
 *  either as a bare `default()` guard term OR inside a comparison / type-predicate
 *  OPERAND (`when (@x = default())`), so such a def is dispatched in the second
 *  (default-deciding) pass with `default()` bound to the real decision. */
export function guardUsesDefault(node: GuardNode | undefined): boolean {
  if (!node) {
    return false;
  }
  switch (node.g) {
    case 'default':
      return true;
    case 'and':
    case 'or':
      return guardUsesDefault(node.left) || guardUsesDefault(node.right);
    case 'not':
      return guardUsesDefault(node.inner);
    case 'cmp':
      return valueUsesDefault(node.left) || valueUsesDefault(node.right);
    case 'call':
      return node.args.some(valueUsesDefault);
    default:
      return false;
  }
}
