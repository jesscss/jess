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
import { word } from './nodes.js';
import type { EvalModes, ValueEvaluator } from './value-eval.js';
import { evalGuard, guardUsesDefault, type TypedResolver, type ValueResolver } from './guard.js';

/** One resolved call argument: positional (no name) or named. */
export interface CallArg {
  value: ValueNode;
  name?: string;
}

/** A selected definition plus the variable bindings its body reads. */
export interface Selection {
  def: MixinDef;
  bindings: Map<string, ValueNode> | null;
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
export type DefaultResolver = (v: ValueNode, boundSoFar: Map<string, ValueNode>) => string;

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
): Map<string, ValueNode> | null {
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

  const bound = new Map<string, ValueNode>();
  const filledByName = new Set<string>();
  for (const p of fixedParams) {
    if (p.name !== undefined && named.has(p.name)) filledByName.add(p.name);
  }

  // Positional args fill the fixed param slots left-to-right, skipping any slot
  // already filled by a named arg.
  let pi = 0;
  for (let k = 0; k < fixedParams.length; k++) {
    const p = fixedParams[k]!;
    let argVal: ValueNode | undefined;
    if (p.name !== undefined && filledByName.has(p.name)) {
      argVal = resolveEager(named.get(p.name)!.value, resolveCaller);
    } else if (pi < positional.length) {
      argVal = resolveEager(positional[pi++]!.value, resolveCaller);
    } else if (p.default !== undefined) {
      // A default value resolves with the params bound so far in scope (Less:
      // it can reference an earlier param), not the caller frame.
      argVal = resolveEagerDefault(p.default, bound, resolveCaller, resolveDefault);
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
      bound.set(restParam.name, word(restBytes.join(' ')));
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
  bound.set('arguments', word(argWords.join(' ')));

  return bound;
}

function resolveEager(v: ValueNode, resolveCaller: ValueResolver): ValueNode {
  // a detached-ruleset arg binds BY REFERENCE (never byte-flattened) so its
  // body + closure survive to the call site.
  if (v.type === 'DetachedRuleset') return v;
  // [value-literal-tag] a pure literal `Word` carries the producer's `LIT_*` tag
  // and has no caller-frame refs to flatten — bind it BY REFERENCE so the tag
  // survives to the callee side (a guard/typed-param materialize reads the stamped
  // field instead of re-sniffing the bytes). Everything else flattens to bytes.
  if (v.type === 'Word' && v.tag !== undefined) return v;
  return word(resolveCaller(v));
}

/** Eager-resolve a DEFAULT param value with the params-bound-so-far overlay
 * (see `DefaultResolver`). By-reference cases (detached ruleset / tagged Word)
 * survive exactly as a call arg does; everything else byte-flattens through the
 * default resolver (falling back to the caller resolver when none is supplied). */
function resolveEagerDefault(
  v: ValueNode,
  boundSoFar: Map<string, ValueNode>,
  resolveCaller: ValueResolver,
  resolveDefault?: DefaultResolver,
): ValueNode {
  if (v.type === 'DetachedRuleset') return v;
  if (v.type === 'Word' && v.tag !== undefined) return v;
  return word(resolveDefault ? resolveDefault(v, boundSoFar) : resolveCaller(v));
}

function valueBytes(v: ValueNode): string {
  // After eager resolution every arg is a Word carrying its bytes.
  return v.type === 'Word' ? v.text : '';
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
  makeCalleeTyped: (bindings: Map<string, ValueNode> | null) => TypedResolver,
  ev: ValueEvaluator | null,
  modes: EvalModes,
  resolveDefault?: DefaultResolver,
): Selection[] {
  // Arity + literal-pattern pre-filter (guard-independent).
  const viable: Array<{ def: MixinDef; bindings: Map<string, ValueNode> | null; order: number }> = [];
  for (let i = 0; i < candidates.length; i++) {
    const def = candidates[i]!;
    const bindings = bindArgs(def, call, resolveCaller, resolveDefault);
    if (bindings === null) continue;
    viable.push({ def, bindings, order: i });
  }

  const guardDeps = (bindings: Map<string, ValueNode> | null, isDefault: () => boolean) => {
    const typed = makeCalleeTyped(bindings);
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
    const ok = !v.def.guard || evalGuard(v.def.guard, guardDeps(v.bindings, () => false));
    if (ok) matched.push(v);
  }

  // Second pass: `default()` candidates fire iff no non-default match.
  const noNonDefaultMatch = matched.length === 0;
  for (const v of defaultCandidates) {
    const ok = evalGuard(v.def.guard!, guardDeps(v.bindings, () => noNonDefaultMatch));
    if (ok) matched.push(v);
  }

  matched.sort((a, b) => a.order - b.order);
  return matched.map((v) => ({ def: v.def, bindings: v.bindings }));
}
