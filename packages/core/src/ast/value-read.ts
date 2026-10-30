/**
 * What a reference read does with the value it reaches: write it out, or only
 * ask about it.
 *
 * A Less variable may hold a mixin reference (`@foo: .a;`, ledger P33,
 * jess#236). Called, looked into or passed to a mixin it is that mixin; written
 * out it has nothing to write, so the read that writes it is an error (owner
 * 2026-10-29: "we are supposed to mark things as being errors when
 * materialized in certain places"). The error sits on the outermost read that
 * writes the value (`b: @bar;` for `@bar: @foo;`, `d: @rest;` for a rest
 * parameter). A condition or a type predicate asks about a value and writes
 * nothing, so there a mixin reference is a value no type question holds for.
 *
 * HARD MODULE BOUNDARY: values from the AST and the error layer only.
 */
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { CallValue, MixinCall, Reference } from './nodes.js';
import type { Any } from './value-eval.js';
import { NO_SPAN, sourceEndOf, sourceStartOf } from './provenance.js';
import { makeAny } from './value-factory.js';

/** The lane facts a read keeps (serialize.ts `Lane`). */
export interface ReadLane {
  /** {@link whileReached} */
  reached: boolean;

  /**
   * The outermost read in progress, which writes what it reaches; or
   * {@link ASKED} on a lane that only asks about values.
   */
  readAt: object | undefined;
  readonly s: { readonly context: Context | undefined };
}

/** {@link ReadLane.readAt} of a guard, a condition or a type predicate's arguments. */
export const ASKED: object = Object.freeze({});

/**
 * The Less type predicates, which ask what a value is. `isdefined` asks
 * whether a name is bound, not what its value is, so it is not one.
 */
const TYPE_PREDICATES: ReadonlySet<string> = new Set([
  'iscolor', 'isnumber', 'isstring', 'iskeyword', 'isurl', 'ispixel', 'ispercentage', 'isem', 'isunit', 'isruleset'
]);

/** Whether a call (by name) is a type predicate, which only asks about its arguments. */
export function asksType(name: string): boolean {
  return (name.charCodeAt(0) | 32) === 105 && TYPE_PREDICATES.has(name.toLowerCase());
}

/**
 * [paren-group] Evaluate a value a reference reached — `withExcluded`'s binding
 * reads, and a map, namespace or mixin-call member — with
 * {@link ReadLane.reached} set: a paren group around one value in it evaluates
 * to its value, Less grouping, wherever the reference is read (`@a: (10px)` →
 * `.x-@{a}` is `.x-10px`, `margin: @a @a` is `10px 10px`, `calc(@a * 2)` is
 * `calc(10px * 2)`, `@media (min-width: @a)` is `(min-width: 10px)`). One
 * written directly in a declaration value, or inside a math function, keeps its
 * parens (`evalCalc` and `evalCall` clear the flag for the math function's
 * arguments; ledger J16, orchestrator judgment under owner delegation
 * 2026-10-06). Written only when it changes. The outermost read (`reader`) is
 * kept as {@link ReadLane.readAt} for the same span.
 *
 * ponytail: a group the value evaluates only after an await keeps its parens;
 * carry the flag through the continuation if a plugin value needs it.
 */
export function whileReached<T>(e: ReadLane, run: () => T, reader?: object): T {
  if (e.reached) {
    return run();
  }
  const outer = e.readAt;
  e.reached = true;
  e.readAt = outer ?? reader;
  try {
    return run();
  } finally {
    e.reached = false;
    e.readAt = outer;
  }
}

/** A reference whose base names a mixin, with no call and no lookup. */
export function isMixinReference(value: CallValue): boolean {
  return !isValueSlotArray(value) && value.type === 'Reference' && value.steps.length === 0
    && !isValueSlotArray(value.base) && value.base.type === 'MixinCall';
}

/**
 * `reader` reached a mixin reference. Asked about, it is a value no type
 * question holds for; written out, it is `eval/uncalled-mixin-reference` at
 * the outermost read that writes it.
 */
export function readMixinReference(e: ReadLane, reader: object): Any {
  const at = e.readAt ?? reader;
  if (at === ASKED) {
    return makeAny(spelling(reader));
  }
  throw ERR.uncalledMixinReference({ node: at, ...callSiteLocation(at, e.s), meta: { name: spelling(at) } });
}

/** A read as it was written (`@foo`, `@r[@foo]`). */
function spelling(read: object): string {
  return 'raw' in read && typeof read.raw === 'string' ? read.raw : '';
}

/**
 * The mixin a reference call (`@foo();`) reached through a variable, placed at
 * that call: the variable's mixin carries no span of its own, so a failure to
 * resolve it would otherwise point at no source.
 */
export function calledAt(mixin: MixinCall, call: Reference): MixinCall {
  return sourceStartOf(mixin) !== NO_SPAN || sourceStartOf(call) === NO_SPAN
    ? mixin
    : { ...mixin, _s: sourceStartOf(call), _e: sourceEndOf(call) };
}
