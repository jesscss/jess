/**
 * Clean-room tree2 mixin DISPATCH: overloaded-definition selection by arity,
 * literal-value pattern match, named/default params, and guards. (rung: guards)
 *
 * HARD MODULE BOUNDARY: under `tree2/`, imports nothing from the legacy tree
 * module. Argument
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
import { Word } from './nodes.js';
import { Kind } from './node.js';
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
 * Bind a call's args to a definition's params. Returns the binding map, or
 * `null` if the def cannot accept these args (arity / pattern mismatch).
 * Args are resolved EAGERLY to byte literals in the CALLER frame (Less
 * semantics), matching the pre-guards behaviour.
 */
export function bindArgs(
  def: MixinDef,
  call: MixinCall,
  resolveCaller: ValueResolver,
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
      argVal = resolveEager(p.default, resolveCaller);
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
      bound.set(restParam.name, new Word(restBytes.join(' ')));
    }
  }

  // `@arguments`: all positional args joined by a space (Less special var).
  const argWords = positional.map((a) => valueBytes(resolveEager(a.value, resolveCaller)));
  bound.set('arguments', new Word(argWords.join(' ')));

  return bound;
}

function resolveEager(v: ValueNode, resolveCaller: ValueResolver): ValueNode {
  // [R4] a detached-ruleset arg binds BY REFERENCE (never byte-flattened) so its
  // body + closure survive to the call site.
  if (v.kind === Kind.DetachedRuleset) return v;
  // [value-literal-tag] a pure literal `Word` carries the producer's `LIT_*` tag
  // and has no caller-frame refs to flatten — bind it BY REFERENCE so the tag
  // survives to the callee side (a guard/typed-param materialize reads the stamped
  // field instead of re-sniffing the bytes). Everything else flattens to bytes.
  if (v instanceof Word && v.tag !== undefined) return v;
  return new Word(resolveCaller(v));
}

function valueBytes(v: ValueNode): string {
  // After eager resolution every arg is a Word carrying its bytes.
  return v instanceof Word ? v.text : '';
}

/**
 * [R2] Select every definition that matches a call, in definition order, with
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
): Selection[] {
  // Arity + literal-pattern pre-filter (guard-independent).
  const viable: Array<{ def: MixinDef; bindings: Map<string, ValueNode> | null; order: number }> = [];
  for (let i = 0; i < candidates.length; i++) {
    const def = candidates[i]!;
    const bindings = bindArgs(def, call, resolveCaller);
    if (bindings === null) continue;
    viable.push({ def, bindings, order: i });
  }

  const guardDeps = (bindings: Map<string, ValueNode> | null, isDefault: () => boolean) => {
    const typed = makeCalleeTyped(bindings);
    return {
      resolve: (v: ValueNode) => typed(v).bytes,
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
