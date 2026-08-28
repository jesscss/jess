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
 *   - `and` / `or` are combined here (over leaf booleans), SHORT-CIRCUITING,
 *   - `not` negates here,
 *   - truthiness (`$if($a)`) is one TYPED predicate here — `.jess`'s §4.4 rule,
 *     falsy iff `false` / `null` / `""` / `()`; the dialects lower their own
 *     condition to comparisons instead (§4.4.2) and never reach it,
 *   - `default()` is a DISPATCH decision owned here (true iff no other def
 *     matched), supplied to `evalGuard` as a callback.
 * Only `cmp` (a comparison like `@a > 0`) and `call` (a boolean function like
 * `iscolor(@a)`) reach the evaluator.
 */

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { ValueSlot } from './nodes.js';
import { type EvalModes, type ValueEvaluator, type ValueGroup } from './value-eval.js';
import { makeList } from './value-factory.js';
import { isTruthy } from './value-truth.js';

/**
 * A guard condition tree. Never serialized to CSS — evaluated to a boolean.
 *
 * `cmp` and `match` are the SAME comparison in the two positions §4.2a
 * distinguishes, and carry the identical shape so they are one hidden class:
 *
 *  - `cmp` — VALUE position (`if(@a < @b, …)`, `$( … )`, `@if`). An ASSERTION:
 *    operands with no common ground raise, because "is a less than b" has no
 *    honest answer and `false` in both directions is a lie (§4.2).
 *  - `match` — GUARD position (`when ( … )`). A MATCH TEST: no common ground
 *    means this definition does not apply to these arguments, which IS an
 *    answer. `.m(1, true) when (@a < @b)` must not fail the compile.
 *
 * Which one a comparison is, is decided by the front end at PARSE time from the
 * position it was written in (§12.0 — lower to the `.jess` you want, then read
 * off the node). Nothing at eval time inspects context or a mode to choose.
 */
export type GuardNode =
  | { readonly g: 'cmp'; readonly op: string; readonly left: ValueSlot; readonly right: ValueSlot }
  | { readonly g: 'match'; readonly op: string; readonly left: ValueSlot; readonly right: ValueSlot }
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
      /*
       * SHORT-CIRCUIT (O-TRUTH-2, RESOLVED). The right operand is not evaluated
       * once the left decides the answer. An earlier version evaluated both, on
       * the premise that a guard is side-effect-free — true for Less, FALSE for
       * Sass, where the right operand may RAISE:
       *
       *   unitMode: 'strict'
       *   @if false and (2px > 1em)   ->  the RHS must never be reached
       *
       * For Less this only ever makes FEWER things raise, so it is safe there.
       * The walk stays synchronous whenever the left operand is, so a settled
       * guard never gains a microtask hop.
       */
      const decided = node.g === 'and' ? false : true;
      const l = evalGuard(node.left, deps);
      const rest = (a: boolean): MaybePromise<boolean> => a === decided ? decided : evalGuard(node.right, deps);
      return isThenable(l) ? l.then(rest) : rest(l);
    }
    case 'not': {
      const inner = evalGuard(node.inner, deps);
      return isThenable(inner) ? inner.then(value => !value) : !inner;
    }
    case 'truth': {
      /*
       * `.jess` truthiness (§4.4): falsy iff `false`, `null`, `""` or `()`.
       * ONE typed predicate over the materialized value — never a byte test.
       * The dialects do not arrive here: they lower to comparisons (§4.4.2).
       */
      const value = deps.resolveTyped(node.value);
      return isThenable(value) ? value.then(isTruthy) : isTruthy(value);
    }
    case 'cmp':
    case 'match': {
      const ev = deps.ev;
      if (!ev) {
        return false;
      }
      const left = deps.resolveTyped(node.left);
      const right = deps.resolveTyped(node.right);

      /*
       * The node's own `g` picks the primitive — the assertion or the match test
       * (§4.2a). Both read the SAME ground; they differ only in what they make
       * of a pair that has none, so the two positions cannot drift apart.
       */
      const compare = node.g === 'match'
        ? (a: ValueGroup, b: ValueGroup): boolean => ev.compareMatch(node.op, a, b, deps.modes)
        : (a: ValueGroup, b: ValueGroup): boolean => ev.compare(node.op, a, b, deps.modes);
      return isThenable(left) || isThenable(right)
        ? Promise.all([left, right]).then(([a, b]) => compare(a, b))
        : compare(left, right);
    }
    case 'call': {
      const ev = deps.ev;
      if (!ev) {
        return false;
      }

      /*
       * Resolve into `settled` while every operand stays synchronous; the first
       * awaitable one moves the whole list into `pending`, so the common case
       * allocates exactly the one array the old `.map` did.
       */
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
      return v.name.toLowerCase() === 'default' || v.args.some(a => valueUsesDefault(a.value));
    case 'Block':
      return valueUsesDefault(v.value);
    case 'Operation':
      return valueUsesDefault(v.left) || valueUsesDefault(v.right);
    case 'Sequence':
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
    case 'match':
      return valueUsesDefault(node.left) || valueUsesDefault(node.right);
    case 'call':
      return node.args.some(valueUsesDefault);
    default:
      return false;
  }
}
