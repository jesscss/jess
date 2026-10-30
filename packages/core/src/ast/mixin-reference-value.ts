/**
 * A Less variable may hold a mixin reference (`@foo: .a;`, ledger P33,
 * jess#236): a reference that names a mixin and neither calls it nor looks a
 * member up. Called (`@foo();`), looked into (`@foo[x]`) or passed as a mixin
 * argument it is that mixin; written into a value it has nothing to write, so
 * the read that writes it is an error (owner 2026-10-29: "we are supposed to
 * mark things as being errors when materialized in certain places").
 *
 * HARD MODULE BOUNDARY: values from the AST and the error layer only.
 */
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { CallValue, MixinCall, Reference } from './nodes.js';
import { NO_SPAN, sourceEndOf, sourceStartOf } from './provenance.js';

/** A reference whose base names a mixin, with no call and no lookup. */
export function isMixinReference(value: CallValue): boolean {
  return !isValueSlotArray(value) && value.type === 'Reference' && value.steps.length === 0
    && !isValueSlotArray(value.base) && value.base.type === 'MixinCall';
}

/** `eval/uncalled-mixin-reference` at the read (`reader`, spelled `name`) that writes a mixin reference into a value. */
export function mixinReferenceAsValue(reader: object, name: string, s: { readonly context: Context | undefined }): never {
  throw ERR.uncalledMixinReference({ node: reader, ...callSiteLocation(reader, s), meta: { name } });
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
