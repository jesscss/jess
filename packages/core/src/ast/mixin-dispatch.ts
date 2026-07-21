/**
 * Clean-room mixin DISPATCH: overloaded-definition selection by arity,
 * literal-value pattern match, named/default params, and guards.
 *
 * BOUNDARY-CLEAN: imports nothing from the legacy `../tree` module. Argument
 * values are resolved to bytes through a caller-supplied resolver (the same
 * `valueText` the serializer uses) and guard leaves go through the injected
 * `ValueService`. All selection STRUCTURE (arity/pattern/named/default) is owned
 * here.
 *
 * Less semantics reproduced:
 *   - A call resolves against ALL same-name definitions visible up the scope
 *     chain (in definition order).
 *   - A definition is a candidate iff its params can BIND the call's args
 *     (arity, considering defaults / variadic `...` / named args) AND every
 *     literal-pattern param equals the corresponding arg's resolved bytes.
 *   - Among candidates, guards are evaluated; a def matches iff it has no guard
 *     or the guard is true. `default()` is true iff no NON-default candidate
 *     matched.
 *   - ALL matching bodies expand, in definition order.
 */

import type { MixinCall, MixinDef, Param, ValueNode } from './nodes.js';
import { any, isLiteralNode, isTypedLiteral } from './nodes.js';
import type { EvalModes, ValueEvaluator } from './value-eval.js';
import { evalGuard, guardUsesDefault, type TypedResolver, type ValueResolver } from './guard.js';

/** One resolved call argument: positional (no name) or named. */
export interface CallArg {
  value: CallValue;
  name?: string;
  /** [spread] `@args...` — `value` is a list variable to SPLAT into positional
   *  args at the call site before binding (Less variadic-forwarding). */
  spread?: boolean;
}

/** A mixin-call argument is normally a value, but Less also permits a deferred
 * typed mixin invocation passed to another mixin. */
export type CallValue = ValueNode | MixinCall;

/** A selected definition plus the variable bindings its body reads. */
export interface Selection {
  def: MixinDef;
  bindings: Map<string, CallValue> | null;
}

/** The two legal default() decision passes select incompatible definitions. */
export class DefaultGuardAmbiguityError extends Error {
  constructor() {
    super('Ambiguous use of default() in mixin guard dispatch.');
  }
}

/**
 * Resolve a DEFAULT param value to bytes. Unlike a call arg (resolved in the
 * caller frame), a default value is evaluated with the params bound SO FAR in
 * scope (Less semantics: `@hover-background: darken(@background, 7.5%)` reads the
 * `@background` param, not a caller variable). `boundSoFar` is the in-progress
 * binding map (params in parameter order); the callee threads it to an overlay
 * frame. Absent (dispatch without a frame context), defaults fall back to the
 * caller resolver.
 */
export type DefaultResolver = (
  v: ValueNode,
  boundSoFar: Map<string, CallValue>,
  def: MixinDef,
) => string;

/**
 * Bind a call's args to a definition's params. Returns the binding map, or
 * `null` if the def cannot accept these args (arity / pattern mismatch).
 * Args are resolved EAGERLY to byte literals in the CALLER frame (Less
 * semantics), matching the pre-guards behaviour.
 */
export function bindArgs(
  def: MixinDef,
  call: MixinCall,
  resolveCaller: ValueResolver,
  resolveDefault?: DefaultResolver,
): Map<string, CallValue> | null {
  const params = def.params;
  const positional: CallArg[] = [];
  const named = new Map<string, CallArg>();
  for (const a of call.args) {
    if (a.name !== undefined) named.set(a.name, a);
    else positional.push(a);
  }

  const restIndex = params.findIndex((p) => p.rest);
  const hasRest = restIndex >= 0;
  const fixedParams = hasRest ? params.slice(0, restIndex) : params;

  // A named arg must correspond to a real (named) param.
  for (const key of named.keys()) {
    if (!fixedParams.some((p) => p.name === key)) return null;
  }

  const bound = new Map<string, CallValue>();

  // Positional args fill the fixed param slots left-to-right, skipping any slot
  // already filled by a named arg.
  let pi = 0;
  for (let k = 0; k < fixedParams.length; k++) {
    const p = fixedParams[k]!;
    let argVal: CallValue | undefined;
    if (p.name !== undefined && named.has(p.name)) {
      argVal = resolveEager(named.get(p.name)!.value, resolveCaller);
    } else if (pi < positional.length) {
      argVal = resolveEager(positional[pi++]!.value, resolveCaller);
    } else if (p.default !== undefined) {
      // A default value resolves with the params bound so far in scope (Less:
      // it can reference an earlier param), overlaid on the mixin's DEFINITION
      // scope (`@parameter: @parameterDefault` reads the def-scope `@parameterDefault`,
      // not a same-name caller var) — not the caller frame.
      argVal = resolveEagerDefault(p.default, bound, def, resolveCaller, resolveDefault);
    } else {
      return null; // required slot unfilled
    }
    // Literal-pattern param: the bound arg bytes must equal the pattern bytes.
    if (p.pattern !== undefined) {
      const argBytes = valueBytes(argVal);
      const patBytes = resolveCaller(p.pattern);
      if (argBytes !== patBytes) return null;
    } else if (p.name !== undefined) {
      bound.set(p.name, argVal);
    }
  }

  // Leftover positional args: only legal if the def is variadic.
  const leftover = positional.slice(pi);
  if (!hasRest && leftover.length > 0) return null;

  if (hasRest) {
    const restParam = params[restIndex]!;
    const restBytes = leftover.map((a) => valueBytes(resolveEager(a.value, resolveCaller)));
    if (restParam.name !== undefined) {
      bound.set(restParam.name, any(restBytes.join(' ')));
    }
  }

  // `@arguments` (Less special var): the bound value of EVERY variable param slot,
  // in PARAMETER order — with named args placed in their slot, defaulted slots
  // filled, all post-eval — joined by a space. This is NOT the raw positional call
  // args: a named-only call still populates @arguments, defaulted slots appear, and
  // the order follows the params, not the call. Pattern-literal slots bind no
  // variable and contribute nothing; an empty variadic slot contributes nothing.
  // `bound` already holds exactly these values in insertion (= parameter) order, so
  // read them straight off it (matches less@4.6.3).
  const argWords: string[] = [];
  for (const val of bound.values()) {
    const bytes = valueBytes(val);
    if (bytes !== '') argWords.push(bytes);
  }
  bound.set('arguments', any(argWords.join(' ')));

  return bound;
}

function resolveEager(v: CallValue, resolveCaller: ValueResolver): CallValue {
  // a detached-ruleset arg binds BY REFERENCE (never byte-flattened) so its
  // body + closure survive to the call site.
  if (v.type === 'DetachedRuleset' || v.type === 'MixinCall') return v;
  // A fully typed list carries comparison-relevant item tags (notably compatible
  // units) and no caller-frame reads. Preserve it by reference just like one typed
  // literal; any structure containing a reference or computed value still resolves
  // eagerly in the caller frame below.
  if (isTypedGuardValue(v)) return v;
  return any(resolveCaller(v));
}

function isTypedGuardValue(v: CallValue): v is ValueNode {
  if (isTypedLiteral(v)) return true;
  if (v.type === 'List') return v.items.every(isTypedGuardValue);
  return v.type === 'SpacedValue' && v.parts.every(isTypedGuardValue);
}

/** Eager-resolve a DEFAULT param value with the params-bound-so-far overlay
 * (see `DefaultResolver`). By-reference cases (detached ruleset / typed literal)
 * survive exactly as a call arg does; everything else byte-flattens through the
 * default resolver (falling back to the caller resolver when none is supplied). */
function resolveEagerDefault(
  v: ValueNode,
  boundSoFar: Map<string, CallValue>,
  def: MixinDef,
  resolveCaller: ValueResolver,
  resolveDefault?: DefaultResolver,
): CallValue {
  if (v.type === 'DetachedRuleset') return v;
  if (isTypedLiteral(v)) return v;
  return any(resolveDefault ? resolveDefault(v, boundSoFar, def) : resolveCaller(v));
}

function valueBytes(v: CallValue): string {
  // After eager resolution every arg is a literal leaf carrying its bytes in `src`.
  return isLiteralNode(v) ? v.src : '';
}

/**
 * Select every definition that matches a call, in definition order, with
 * its bindings. Args resolve to bytes in the caller frame (arity/pattern);
 * guard leaves compare TYPED values in the callee frame through the injected
 * `ValueEvaluator`.
 */
export function selectDefinitions(
  candidates: MixinDef[],
  call: MixinCall,
  resolveCaller: ValueResolver,
  makeCalleeTyped: (
    def: MixinDef,
    bindings: Map<string, CallValue> | null,
    isDefault: () => boolean,
  ) => TypedResolver,
  ev: ValueEvaluator | null,
  modes: EvalModes,
  resolveDefault?: DefaultResolver,
): Selection[] {
  // Arity + literal-pattern pre-filter (guard-independent).
  const viable: Array<{ def: MixinDef; bindings: Map<string, CallValue> | null; order: number }> = [];
  for (let i = 0; i < candidates.length; i++) {
    const def = candidates[i]!;
    const bindings = bindArgs(def, call, resolveCaller, resolveDefault);
    if (bindings === null) continue;
    viable.push({ def, bindings, order: i });
  }

  const guardDeps = (def: MixinDef, bindings: Map<string, CallValue> | null, isDefault: () => boolean) => {
    // A guard resolves its free variables in the mixin's DEFINITION scope (closure),
    // so `makeCalleeTyped` keys the typed resolver off the def (see serialize `dispatch`).
    // `isDefault` also threads to the resolver so a `default()` OPERAND (`@x =
    // default()`) folds to the decision, not just a bare `default()` guard term.
    const typed = makeCalleeTyped(def, bindings, isDefault);
    return {
      resolveTyped: typed,
      ev,
      modes,
      isDefault,
    };
  };

  // First pass: non-default guarded/unguarded matches.
  const matched: typeof viable = [];
  const defaultCandidates: typeof viable = [];
  for (const v of viable) {
    if (guardUsesDefault(v.def.guard)) {
      defaultCandidates.push(v);
      continue;
    }
    const ok = !v.def.guard || evalGuard(v.def.guard, guardDeps(v.def, v.bindings, () => false));
    if (ok) matched.push(v);
  }

  // Second pass: `default()` candidates fire iff no non-default match.
  const noNonDefaultMatch = matched.length === 0;
  if (noNonDefaultMatch && defaultCandidates.length > 0) {
    const selectedWhenDefault = defaultCandidates.filter(v =>
      evalGuard(v.def.guard!, guardDeps(v.def, v.bindings, () => true)),
    );
    const selectedWhenNotDefault = defaultCandidates.filter(v =>
      evalGuard(v.def.guard!, guardDeps(v.def, v.bindings, () => false)),
    );
    const conflictingSingleSelections = selectedWhenDefault.length === 1
      && selectedWhenNotDefault.length === 1
      && selectedWhenDefault[0]!.def !== selectedWhenNotDefault[0]!.def;
    if (selectedWhenDefault.length > 1 || selectedWhenNotDefault.length > 1 || conflictingSingleSelections) {
      throw new DefaultGuardAmbiguityError();
    }
    // No ordinary candidate matched, so Less resolves `default()` to true.
    // `not(default())` is therefore false and cannot manufacture a fallback
    // body. The false pass is nevertheless part of ambiguity detection: a
    // different definition (or several definitions) that would win there makes
    // the overload set intrinsically ambiguous, even though it is not emitted.
    matched.push(...selectedWhenDefault);
  } else {
    for (const v of defaultCandidates) {
      const ok = evalGuard(v.def.guard!, guardDeps(v.def, v.bindings, () => false));
      if (ok) matched.push(v);
    }
  }

  matched.sort((a, b) => a.order - b.order);
  return matched.map((v) => ({ def: v.def, bindings: v.bindings }));
}
