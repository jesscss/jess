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

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
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

/**
 * Resolve a value node to its (variable-resolved, un-evaluated) source bytes.
 * Awaitable for the same reason {@link TypedResolver} is: a mixin argument may
 * name a value the engine can only produce by awaiting. Settled values are
 * returned unwrapped, so ordinary dispatch never touches a promise.
 */
export type ValueResolver = (v: ValueSlot) => MaybePromise<string>;

/**
 * Resolve a value node to a materialized TYPED value object.
 *
 * A guard operand can name a value the engine cannot produce without awaiting —
 * a `@plugin` function result, say — so this is a {@link MaybePromise}. It stays
 * SYNCHRONOUS whenever the value is: the resolver returns the value itself, and
 * every consumer below checks `isThenable` before reaching for a promise. No
 * guard that could already be answered synchronously gains a microtask hop.
 */
export type TypedResolver = (v: ValueSlot) => MaybePromise<ValueGroup>;

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
export function evalGuard(node: GuardNode, deps: GuardEvalDeps): MaybePromise<boolean> {
  switch (node.g) {
    case 'and':
    case 'or': {
      // Both operands are evaluated (a guard is side-effect-free, and this
      // preserves the existing evaluation order exactly); only the COMBINE waits.
      const l = evalGuard(node.left, deps);
      const r = evalGuard(node.right, deps);
      const join = node.g === 'and'
        ? (a: boolean, b: boolean) => a && b
        : (a: boolean, b: boolean) => a || b;
      return isThenable(l) || isThenable(r)
        ? Promise.all([l, r]).then(([a, b]) => join(a, b))
        : join(l, r);
    }
    case 'not': {
      const inner = evalGuard(node.inner, deps);
      return isThenable(inner) ? inner.then(value => !value) : !inner;
    }
    case 'truth': {
      // Less: a bare-value guard is true only if it evaluates to `true`.
      const value = deps.resolveTyped(node.value);
      const test = (v: ValueGroup): boolean => emitValue(v).trim() === 'true';
      return isThenable(value) ? value.then(test) : test(value);
    }
    case 'cmp': {
      const ev = deps.ev;
      if (!ev) {
        return false;
      }
      const left = deps.resolveTyped(node.left);
      const right = deps.resolveTyped(node.right);
      const compare = (a: ValueGroup, b: ValueGroup): boolean => ev.compare(node.op, a, b, deps.modes);
      return isThenable(left) || isThenable(right)
        ? Promise.all([left, right]).then(([a, b]) => compare(a, b))
        : compare(left, right);
    }
    case 'call': {
      const ev = deps.ev;
      if (!ev) {
        return false;
      }
      // Resolve into `settled` while every operand stays synchronous; the first
      // awaitable one moves the whole list into `pending`, so the common case
      // allocates exactly the one array the old `.map` did.
      const settled: ValueGroup[] = [];
      let pending: Array<MaybePromise<ValueGroup>> | null = null;
      for (const arg of node.args) {
        const value = deps.resolveTyped(arg);
        if (pending) {
          pending.push(value);
        } else if (isThenable(value)) {
          pending = [...settled, value];
        } else {
          settled.push(value);
        }
      }
      const check = (values: ValueGroup[]): boolean =>
        ev.typeCheck(node.name, makeList(values, ','), deps.modes);
      return pending ? Promise.all(pending).then(check) : check(settled);
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
