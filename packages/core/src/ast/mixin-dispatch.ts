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

import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type { CallArg, CallValue, MixinCall, MixinDefinition, ValueSlot } from './nodes.js';
import { any, isLiteralNode, isTypedLiteral, isValueBlock } from './nodes.js';
import type { EvalModes, ValueEvaluator } from './value-eval.js';
import { evalGuard, guardUsesDefault, type TypedResolver, type ValueResolver } from './guard.js';

/** The call-argument shape now lives with the nodes that carry it — a
 *  {@link CallArg} is the same node for a mixin call and a function call, so it
 *  cannot be owned by the mixin module. Re-exported here for existing importers. */
export type { CallArg, CallValue } from './nodes.js';

/** A selected definition plus the variable bindings its body reads. */
export interface Selection {
  def: MixinDefinition;
  bindings: Map<string, CallValue> | null;
  boundSourceKeys: readonly CallValue[] | null;
}

/** Local MaybePromise glue: importing serialize.ts's copy would cycle (it imports this module). */
function mapMaybe<T, U>(m: MaybePromise<T>, f: (t: T) => MaybePromise<U>): MaybePromise<U> {
  return isThenable(m) ? m.then(f) : f(m);
}

/** The two legal default() decision passes select incompatible definitions. */
export class DefaultGuardAmbiguityError extends Error {
  constructor() {
    super('Ambiguous use of default() in mixin guard dispatch.');
  }
}

/**
 * Resolve a DEFAULT parameter to its eager {@link CallValue} snapshot. Unlike a
 * call argument (resolved in the caller frame), a default is evaluated with the
 * parameters bound SO FAR in scope. Returning the snapshot, rather than only
 * its bytes, lets a dialect retain typed provenance beside that same binding.
 */
export type DefaultResolver = (
  v: ValueSlot,
  boundSoFar: Map<string, CallValue>,
  def: MixinDefinition,
) => MaybePromise<CallValue>;

/**
 * Optional dialect adapter for a source that must retain extra binding-domain
 * provenance. Returning `undefined` keeps the ordinary eager binding route.
 * The callback runs inside the existing fixed-parameter pass, so it must return
 * the same eager snapshot the parameter will bind.
 */
export type BoundSourceResolver = (
  value: CallValue
) => MaybePromise<CallValue> | undefined;

/**
 * Exceptional sole-rest binding route for an evaluated structural argument.
 * The returned slots are the semantic rest members; ordinary authored rest
 * arguments return `undefined` and keep the existing one-argument boundary.
 */
export type RestBoundSourceResolver = (
  value: CallValue
) => MaybePromise<readonly ValueSlot[]> | undefined;

export interface BoundSourceResolvers {
  readonly resolve: BoundSourceResolver;
  readonly resolveRest?: RestBoundSourceResolver;
}

/**
 * Candidate-local lifetime for provenance side entries created while binding.
 * A candidate's entries must remain available to its guard, but rejected
 * candidates must release them before dispatch returns.
 */
export interface BoundSourceTracker extends BoundSourceResolvers {
  begin(): void;
  finish(): readonly CallValue[] | null;
  discard(keys: readonly CallValue[]): void;
}

/**
 * Bind a call's args to a definition's params. Returns the binding map, or
 * `null` if the def cannot accept these args (arity / pattern mismatch).
 * Args are resolved in the CALLER frame (Less semantics). Typed authored
 * values, including nested lists, stay structural across the binding boundary.
 * Dialect adapters may retain evaluated structure beside the eager snapshot;
 * other computed caller values collapse to their resolved literal bytes.
 */
/**
 * Mutable binding state. Allocated ONLY when a slot actually suspends: the
 * synchronous path below is a straight-line loop over stack locals and creates
 * no closure, no context and no state object — exactly what it did before the
 * awaitable lane existed.
 */
interface BindState {
  readonly def: MixinDefinition;
  readonly params: readonly MixinDefinition['params'][number][];
  readonly fixedParams: readonly MixinDefinition['params'][number][];
  readonly positional: CallArg[];
  readonly named: Map<string, CallArg>;
  readonly hasRest: boolean;
  readonly restIndex: number;
  readonly bound: Map<string, CallValue>;
  readonly argumentSlots: ValueSlot[];
  readonly resolveCaller: ValueResolver;
  readonly resolveDefault: DefaultResolver | undefined;
  readonly boundSources: BoundSourceResolvers | undefined;
  pi: number;
}

export function bindArgs(
  def: MixinDefinition,
  call: MixinCall,
  resolveCaller: ValueResolver,
  resolveDefault?: DefaultResolver,
  boundSources?: BoundSourceResolvers
): MaybePromise<Map<string, CallValue> | null> {
  const params = def.params;
  const positional: CallArg[] = [];
  const named = new Map<string, CallArg>();
  for (const a of call.args) {
    if (a.name !== undefined) {
      named.set(a.name, a);
    } else {
      positional.push(a);
    }
  }

  const restIndex = params.findIndex(p => p.rest);
  const hasRest = restIndex >= 0;
  const fixedParams = hasRest ? params.slice(0, restIndex) : params;

  // A named arg must correspond to a real (named) param.
  for (const key of named.keys()) {
    if (!fixedParams.some(p => p.name === key)) {
      return null;
    }
  }

  const bound = new Map<string, CallValue>();

  /*
   * An assigned content block (`$ > m(): @{ … }`, the lowering of Sass
   * `@include m { … }`) is NOT an argument: it binds an ordinary scoped variable
   * `content` in the call frame, the way `arguments` is bound in a JS function.
   * `$content()` is then a regular call on that regular variable — the evaluator
   * knows nothing about the name. It is seeded before the param walk so a param
   * literally named `$content` still wins, and so a param DEFAULT may read it.
   * Bound ONLY when a block was passed: `bindArgs` runs for Less dispatch too,
   * and seeding unconditionally would shadow a caller's own `content` variable.
   */
  if (call.content !== null) {
    bound.set('content', call.content);
  }
  const argumentSlots: ValueSlot[] = [];
  let pi = 0;

  // ---- synchronous fast path: straight-line, allocation-free ----
  for (let k = 0; k < fixedParams.length; k++) {
    const p = fixedParams[k]!;
    let argVal: MaybePromise<CallValue>;
    if (p.name !== undefined && named.has(p.name)) {
      const source = named.get(p.name)!.value;
      argVal = (p.pattern === undefined ? boundSources?.resolve(source) : undefined)
        ?? resolveEager(source, resolveCaller);
    } else if (pi < positional.length) {
      const source = positional[pi++]!.value;
      argVal = (p.pattern === undefined ? boundSources?.resolve(source) : undefined)
        ?? resolveEager(source, resolveCaller);
    } else if (p.default !== undefined) {
      /*
       * A default value resolves with the params bound so far in scope (Less:
       * it can reference an earlier param), overlaid on the mixin's DEFINITION
       * scope (`@parameter: @parameterDefault` reads the def-scope
       * `@parameterDefault`, not a same-name caller var) — not the caller frame.
      */
      argVal = resolveEagerDefault(p.default, bound, def, resolveCaller, resolveDefault);
    } else {
      return null; // required slot unfilled
    }
    if (isThenable(argVal)) {
      const at = k;
      const carried: BindState = {
        def, params, fixedParams, positional, named, hasRest, restIndex,
        bound, argumentSlots, resolveCaller, resolveDefault,
        boundSources, pi
      };
      return argVal.then(settled => resumeFixed(carried, at, settled));
    }

    // Literal-pattern param: the bound arg bytes must equal the pattern bytes.
    if (p.pattern !== undefined) {
      const patBytes = resolveCaller(p.pattern);
      if (isThenable(patBytes)) {
        const at = k;
        const carried: BindState = {
          def, params, fixedParams, positional, named, hasRest, restIndex,
          bound, argumentSlots, resolveCaller, resolveDefault,
          boundSources, pi
        };
        const settled = argVal;
        return patBytes.then(pat => (valueBytes(settled) === pat ? bindFixedFrom(carried, at + 1) : null));
      }
      if (valueBytes(argVal) !== patBytes) {
        return null;
      }
    } else if (p.name !== undefined) {
      bound.set(p.name, argVal);
      if (isValueSlot(argVal)) {
        argumentSlots.push(argVal);
      }
    }
  }

  /*
   * The ordinary non-variadic call finishes right here, having allocated nothing
   * beyond the two collections it must return.
   */
  if (!hasRest) {
    if (positional.length - pi > 0) {
      return null; // leftover positional args and no rest param
    }
    bound.set('arguments', argumentSlots);
    return bound;
  }
  return bindRest({
    def, params, fixedParams, positional, named, hasRest, restIndex,
    bound, argumentSlots, resolveCaller, resolveDefault,
    boundSources, pi
  });
}

/** Resume the fixed-param walk after slot `k`'s value settled. */
function resumeFixed(
  st: BindState,
  k: number,
  argVal: CallValue
): MaybePromise<Map<string, CallValue> | null> {
  const p = st.fixedParams[k]!;
  if (p.pattern !== undefined) {
    return mapMaybe(st.resolveCaller(p.pattern), pat =>
      (valueBytes(argVal) === pat ? bindFixedFrom(st, k + 1) : null));
  }
  if (p.name !== undefined) {
    st.bound.set(p.name, argVal);
    if (isValueSlot(argVal)) {
      st.argumentSlots.push(argVal);
    }
  }
  return bindFixedFrom(st, k + 1);
}

/**
 * The suspended continuation of the fixed-param walk. Same order guarantee as
 * the fast path: slot k+1 never starts before slot k is bound, because a default
 * may read a param an earlier slot bound.
 */
function bindFixedFrom(st: BindState, from: number): MaybePromise<Map<string, CallValue> | null> {
  for (let k = from; k < st.fixedParams.length; k++) {
    const p = st.fixedParams[k]!;
    let argVal: MaybePromise<CallValue>;
    if (p.name !== undefined && st.named.has(p.name)) {
      const source = st.named.get(p.name)!.value;
      argVal = (p.pattern === undefined ? st.boundSources?.resolve(source) : undefined)
        ?? resolveEager(source, st.resolveCaller);
    } else if (st.pi < st.positional.length) {
      const source = st.positional[st.pi++]!.value;
      argVal = (p.pattern === undefined ? st.boundSources?.resolve(source) : undefined)
        ?? resolveEager(source, st.resolveCaller);
    } else if (p.default !== undefined) {
      argVal = resolveEagerDefault(p.default, st.bound, st.def, st.resolveCaller, st.resolveDefault);
    } else {
      return null;
    }
    if (isThenable(argVal)) {
      return argVal.then(settled => resumeFixed(st, k, settled));
    }
    const placed = resumePlace(st, p, argVal);
    if (isThenable(placed)) {
      return placed.then(ok => (ok ? bindFixedFrom(st, k + 1) : null));
    }
    if (!placed) {
      return null;
    }
  }
  return bindRest(st);
}

function resumePlace(
  st: BindState,
  p: MixinDefinition['params'][number],
  argVal: CallValue
): MaybePromise<boolean> {
  if (p.pattern !== undefined) {
    return mapMaybe(st.resolveCaller(p.pattern), pat => valueBytes(argVal) === pat);
  }
  if (p.name !== undefined) {
    st.bound.set(p.name, argVal);
    if (isValueSlot(argVal)) {
      st.argumentSlots.push(argVal);
    }
  }
  return true;
}

function bindRest(st: BindState): MaybePromise<Map<string, CallValue> | null> {
  // Leftover positional args: only legal if the def is variadic.
  const leftover = st.positional.length - st.pi;
  if (!st.hasRest) {
    return leftover > 0 ? null : finishBind(st);
  }
  const restParam = st.params[st.restIndex]!;
  if (leftover === 1 && st.boundSources?.resolveRest !== undefined) {
    const source = st.positional[st.pi]!.value;
    const resolved = st.boundSources.resolveRest(source);
    if (resolved !== undefined) {
      return mapMaybe(resolved, slots => finishRest(st, restParam, slots));
    }
  }
  const restSlots: ValueSlot[] = [];
  const take = (index: number): MaybePromise<Map<string, CallValue> | null> => {
    for (let i = index; i < st.positional.length; i++) {
      const source = st.positional[i]!.value;
      const value = st.boundSources?.resolve(source)
        ?? resolveEager(source, st.resolveCaller);
      if (isThenable(value)) {
        const at = i;
        return value.then((settled) => {
          if (!isValueSlot(settled)) {
            return null;
          }
          restSlots.push(settled);
          return take(at + 1);
        });
      }
      if (!isValueSlot(value)) {
        return null;
      }
      restSlots.push(value);
    }
    return finishRest(st, restParam, restSlots);
  };
  return take(st.pi);
}

function finishRest(
  st: BindState,
  restParam: MixinDefinition['params'][number],
  restSlots: readonly ValueSlot[]
): Map<string, CallValue> {
  if (restParam.name !== undefined) {
    /*
     * A rest is a list of CALL ARGUMENTS, not a flattened value string. A sole
     * authored `a b c` argument consequently remains one nested space-list,
     * while comma/semicolon call groups retain their distinct argument slots.
     * A sole evaluated structural argument may arrive as its semantic members
     * through `resolveRest`; that distinction is parser/eval-owned.
     */
    st.bound.set(restParam.name, restSlots);
  }
  if (st.argumentSlots.length === 0) {
    st.bound.set('arguments', restSlots);
    return st.bound;
  }
  for (const slot of restSlots) {
    st.argumentSlots.push(slot);
  }
  return finishBind(st);
}

function finishBind(st: BindState): Map<string, CallValue> {
  /*
   * `@arguments` (Less special var): the bound value of EVERY variable param slot,
   * in PARAMETER order — with named args placed in their slot, defaulted slots
   * filled, all post-eval. This is NOT the raw positional call args: a named-only
   * call still populates @arguments, defaulted slots appear, and the order follows
   * the params, not the call. Pattern-literal slots bind no variable and
   * contribute nothing; an empty variadic slot contributes nothing. Keep those
   * slots structural so list functions can distinguish a single nested space-list
   * from several ordinary call arguments.
   */
  st.bound.set('arguments', st.argumentSlots);
  return st.bound;
}

function resolveEager(v: CallValue, resolveCaller: ValueResolver): MaybePromise<CallValue> {
  /*
   * a value-block (anonymous-mixin / collection) arg binds BY REFERENCE (never
   * byte-flattened) so its body + closure survive to the call site.
   */
  if ('type' in v && (isValueBlock(v) || v.type === 'MixinCall')) {
    return v;
  }

  /*
   * A fully typed list carries comparison-relevant item tags (notably compatible
   * units) and no caller-frame reads. Preserve it by reference just like one typed
   * literal; any structure containing a reference or computed value still resolves
   * eagerly in the caller frame below.
   */
  if (isTypedCallValue(v)) {
    return v;
  }
  return mapMaybe(resolveCaller(v), any);
}

export function isTypedCallValue(v: CallValue): v is ValueSlot {
  if (!('type' in v)) {
    return v.every(isTypedCallValue);
  }
  if (v.type === 'MixinCall') {
    return false;
  }
  if (isTypedLiteral(v)) {
    return true;
  }
  if (v.type === 'List') {
    return v.value.every(isTypedCallValue);
  }
  return v.type === 'Sequence' && v.parts.every(isTypedCallValue);
}

/** Eager-resolve a DEFAULT param value with the params-bound-so-far overlay
 * (see `DefaultResolver`). By-reference cases (value block / typed literal)
 * survive exactly as a call arg does; everything else byte-flattens through the
 * default resolver (falling back to the caller resolver when none is supplied). */
function resolveEagerDefault(
  v: ValueSlot,
  boundSoFar: Map<string, CallValue>,
  def: MixinDefinition,
  resolveCaller: ValueResolver,
  resolveDefault?: DefaultResolver
): MaybePromise<CallValue> {
  if ('type' in v && isValueBlock(v)) {
    return v;
  }

  if (isTypedCallValue(v)) {
    return v;
  }
  return resolveDefault
    ? resolveDefault(v, boundSoFar, def)
    : mapMaybe(resolveCaller(v), any);
}

function valueBytes(v: CallValue): string {
  // After eager resolution every arg is a literal leaf carrying its bytes in `src`.
  return 'type' in v && v.type !== 'MixinCall' && isLiteralNode(v) ? v.src : '';
}

export function isValueSlot(value: CallValue): value is ValueSlot {
  return !('type' in value && value.type === 'MixinCall');
}

/**
 * Select every definition that matches a call, in definition order, with
 * its bindings. Args resolve to bytes in the caller frame (arity/pattern);
 * guard leaves compare TYPED values in the callee frame through the injected
 * `ValueEvaluator`.
 */
export function selectDefinitions(
  candidates: MixinDefinition[],
  call: MixinCall,
  resolveCaller: ValueResolver,
  makeCalleeTyped: (
    def: MixinDefinition,
    bindings: Map<string, CallValue> | null,
    isDefault: () => boolean,
  ) => TypedResolver,
  ev: ValueEvaluator | null,
  modes: EvalModes,
  resolveDefault?: DefaultResolver,
  onNoViable?: () => void,
  boundSources?: BoundSourceTracker
): MaybePromise<Selection[]> {
  type Viable = {
    def: MixinDefinition;
    bindings: Map<string, CallValue> | null;
    order: number;
  };

  const guardDeps = (def: MixinDefinition, bindings: Map<string, CallValue> | null, isDefault: () => boolean) => {
    /*
     * A guard resolves its free variables in the mixin's DEFINITION scope (closure),
     * so `makeCalleeTyped` keys the typed resolver off the def (see serialize `dispatch`).
     * `isDefault` also threads to the resolver so a `default()` OPERAND (`@x =
     * default()`) folds to the decision, not just a bare `default()` guard term.
     */
    const typed = makeCalleeTyped(def, bindings, isDefault);
    return { resolveTyped: typed, ev, modes, isDefault };
  };

  /**
   * Filter `list` by an awaitable predicate, preserving ORDER. Runs entirely
   * synchronously while every verdict is settled — the ordinary overload set
   * never allocates a promise — and only suspends at the first candidate whose
   * guard must await.
   */
  const filterSerial = (
    list: Viable[],
    keep: (v: Viable) => MaybePromise<boolean>
  ): MaybePromise<Viable[]> => {
    const out: Viable[] = [];
    const step = (index: number): MaybePromise<Viable[]> => {
      for (; index < list.length; index++) {
        const v = list[index]!;
        const verdict = keep(v);
        if (isThenable(verdict)) {
          const at = index;
          return verdict.then((ok) => {
            if (ok) {
              out.push(v);
            }
            return step(at + 1);
          });
        }
        if (verdict) {
          out.push(v);
        }
      }
      return out;
    };
    return step(0);
  };

  /*
   * Arity + literal-pattern pre-filter (guard-independent). Binding a candidate's
   * arguments can await, so this is a fold too; it stays synchronous for a call
   * whose arguments are all settled, which is every ordinary call.
   */
  const viable: Viable[] = [];
  const keysByOrder: Array<readonly CallValue[] | null | undefined> | null = boundSources === undefined ? null : [];
  let discardKeys: ((keys: readonly CallValue[] | null) => void) | undefined;
  let discardUnclaimed: (() => void) | undefined;
  let failTracked: ((error: unknown, active?: boolean) => never) | undefined;
  const prefilter = (index: number): MaybePromise<void> => {
    if (boundSources === undefined) {
      for (; index < candidates.length; index++) {
        const def = candidates[index]!;
        const bound = bindArgs(def, call, resolveCaller, resolveDefault);
        if (isThenable(bound)) {
          const at = index;
          return bound.then((bindings) => {
            if (bindings !== null) {
              viable.push({ def, bindings, order: at });
            }
            return prefilter(at + 1);
          });
        }
        if (bound !== null) {
          viable.push({ def, bindings: bound, order: index });
        }
      }
      return undefined;
    }

    for (; index < candidates.length; index++) {
      const def = candidates[index]!;
      boundSources.begin();
      let bound: MaybePromise<Map<string, CallValue> | null>;
      try {
        bound = bindArgs(def, call, resolveCaller, resolveDefault, boundSources);
      } catch (error) {
        return failTracked!(error, true);
      }
      if (isThenable(bound)) {
        const at = index;
        return bound.then(
          (bindings) => {
            const keys = boundSources.finish();
            if (bindings !== null) {
              viable.push({ def, bindings, order: at });
              keysByOrder![at] = keys;
            } else {
              discardKeys!(keys);
            }
            return prefilter(at + 1);
          },
          error => failTracked!(error, true)
        );
      }
      const keys = boundSources.finish();
      if (bound !== null) {
        viable.push({ def, bindings: bound, order: index });
        keysByOrder![index] = keys;
      } else {
        discardKeys!(keys);
      }
    }
    return undefined;
  };

  const select = (): MaybePromise<Viable[]> => {
    // First pass: non-default guarded/unguarded matches.
    const plain: Viable[] = [];
    const defaultCandidates: Viable[] = [];
    for (const v of viable) {
      (guardUsesDefault(v.def.guard) ? defaultCandidates : plain).push(v);
    }
    return mapMaybe(
      filterSerial(plain, v => !v.def.guard || evalGuard(v.def.guard, guardDeps(v.def, v.bindings, () => false))),
      (matched) => {
        // Second pass: `default()` candidates fire iff no non-default match.
        if (matched.length === 0 && defaultCandidates.length > 0) {
          return mapMaybe(
            filterSerial(defaultCandidates, v =>
              evalGuard(v.def.guard!, guardDeps(v.def, v.bindings, () => true))),
            selectedWhenDefault => mapMaybe(
              filterSerial(defaultCandidates, v =>
                evalGuard(v.def.guard!, guardDeps(v.def, v.bindings, () => false))),
              (selectedWhenNotDefault) => {
                const conflictingSingleSelections = selectedWhenDefault.length === 1
                  && selectedWhenNotDefault.length === 1
                  && selectedWhenDefault[0]!.def !== selectedWhenNotDefault[0]!.def;
                if (selectedWhenDefault.length > 1 || selectedWhenNotDefault.length > 1 || conflictingSingleSelections) {
                  throw new DefaultGuardAmbiguityError();
                }

                /*
                 * No ordinary candidate matched, so Less resolves `default()` to true.
                 * `not(default())` is therefore false and cannot manufacture a fallback
                 * body. The false pass is nevertheless part of ambiguity detection: a
                 * different definition (or several definitions) that would win there makes
                 * the overload set intrinsically ambiguous, even though it is not emitted.
                 */
                for (const v of selectedWhenDefault) {
                  matched.push(v);
                }
                return matched;
              }
            )
          );
        }

        /*
         * The overwhelmingly common overload set has NO `default()` guard at all;
         * short-circuit before allocating a predicate, a filter buffer and a join.
         */
        if (defaultCandidates.length === 0) {
          return matched;
        }
        return mapMaybe(
          filterSerial(defaultCandidates, v =>
            evalGuard(v.def.guard!, guardDeps(v.def, v.bindings, () => false))),
          (extra) => {
            for (const v of extra) {
              matched.push(v);
            }
            return matched;
          }
        );
      }
    );
  };

  if (boundSources === undefined) {
    return mapMaybe(prefilter(0), () => {
      if (viable.length === 0 && candidates.length > 0) {
        onNoViable?.();
      }
      return mapMaybe(select(), (matched) => {
        matched.sort((a, b) => a.order - b.order);
        return matched.map(v => ({
          def: v.def,
          bindings: v.bindings,
          boundSourceKeys: null
        }));
      });
    });
  }

  discardKeys = (keys): void => {
    if (keys !== null) {
      boundSources.discard(keys);
    }
  };
  discardUnclaimed = (): void => {
    for (let index = 0; index < keysByOrder!.length; index++) {
      const keys = keysByOrder![index];
      if (keys !== undefined && keys !== null) {
        keysByOrder![index] = null;
        boundSources.discard(keys);
      }
    }
  };
  failTracked = (error, active = false): never => {
    if (active) {
      discardKeys!(boundSources.finish());
    }
    discardUnclaimed!();
    throw error;
  };

  return mapMaybe(prefilter(0), () => {
    if (viable.length === 0 && candidates.length > 0) {
      onNoViable?.();
    }
    const finishSelection = (matched: Viable[]): Selection[] => {
      matched.sort((a, b) => a.order - b.order);
      const selections = matched.map(v => ({
        def: v.def,
        bindings: v.bindings,
        boundSourceKeys: keysByOrder![v.order] ?? null
      }));
      for (const candidate of matched) {
        keysByOrder![candidate.order] = null;
      }
      discardUnclaimed!();
      return selections;
    };
    let selected: MaybePromise<Viable[]>;
    try {
      selected = select();
    } catch (error) {
      return failTracked!(error);
    }
    if (!isThenable(selected)) {
      return finishSelection(selected);
    }
    return selected.then(finishSelection, error => failTracked!(error));
  });
}
