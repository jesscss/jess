/**
 * The `ValueEvaluator` seam implementation — boundary-clean, synchronous on the
 * ordinary path and awaitable only when an injected fn capability needs it,
 * built entirely on the value domain (operate + kind-dispatch + free
 * serializer): no legacy `../tree` node, no reparse, no `render()` walk, no async
 * record/replay.
 *
 * Named calls dispatch through a caller-populated {@link FnRegistry}; every other
 * named call is treated as an unknown function emitted verbatim.
 *
 * HARD MODULE BOUNDARY: imports only the engine value modules, and the
 * provenance side table only to read the authored layout of a call it writes
 * out as-is.
 */
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { emitValue, isValueGroupArray, itemBoundary, joinGroup, writtenArgument, type ArgumentKeyword, type EvalModes, type FnScope, type ValueEvaluator, type ValueGroup, type Value, type WrittenArguments } from './value-eval.js';
import { valueLayoutOf } from './provenance.js';
import type { Fn, FnIo } from './functions/types.js';
import { sepGlue } from './value-eval.js';
import { groupItems, groupSeparator } from './value-list.js';
import { operate } from './value-operate.js';
import { compare as compareValues, compareMatch as compareMatchValues, typeCheck as typeCheckValues } from './value-guards.js';
import type { FnRegistry } from './value-dispatch.js';
import { dispatchFn, FunctionDeclined } from './value-dispatch.js';
import { makeKeyword } from './value-factory.js';
import { emitCompressed } from './compress.js';

/** Join an unknown-fn's arg bytes verbatim (per separator). Under compress the
 *  comma list-divider tightens (`,`) and each arg folds by its type, as in any
 *  other value position; space and `/` separators are significant and kept
 *  (v5 keeps `/` spaced). A keyword argument keeps its keyword
 *  ({@link writtenArgument}), and pretty output keeps the comments and line
 *  breaks the parser recorded between and inside the `authored` arguments
 *  (ledger F11). */
function verbatimArgs(args: ValueGroup, modes?: EvalModes, authored?: readonly ArgumentKeyword[]): string {
  const separator = groupSeparator(args);
  const compress = modes?.compress === true;
  const glue = separator === ' ' ? ' ' : sepGlue(separator, compress);
  const emit = compress ? emitCompressed : emitValue;
  const items = groupItems(args);
  if (authored === undefined) {
    return items.map(emit).join(glue);
  }
  const separators = compress ? undefined : valueLayoutOf(authored);
  let out = '';
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    const argument = authored[index];
    const members = compress || argument === undefined || !Array.isArray(argument.value) ? undefined : valueLayoutOf(argument.value);
    const bytes = members !== undefined && isValueGroupArray(item)
      ? joinGroup(item, ' ', emit, members, compress)
      : emit(item);
    const spelled = argument === undefined ? bytes : writtenArgument(argument, bytes, compress);
    out += index === 0 ? spelled : itemBoundary(separators?.[index - 1], glue, compress) + spelled;
  }
  return out;
}

/** Preserve an optional CSS call, as written, after name resolution or invocation failed. */
function fallbackCall(name: string, args: ValueGroup, modes?: EvalModes, written?: WrittenArguments, authored?: readonly ArgumentKeyword[]): Value {
  return makeKeyword(`${name}(${verbatimArgs(written?.args ?? args, modes, written?.keywords ?? authored)})`);
}

/**
 * A registered callable has already been selected. Its failure is therefore an
 * invocation result, not a name-resolution miss: preserve it only in the
 * caller-selected lenient mode, otherwise propagate the original failure.
 */
function recoverCallFailure(
  error: unknown,
  name: string,
  args: ValueGroup,
  modes: EvalModes,
  written?: WrittenArguments,
  authored?: readonly ArgumentKeyword[]
): Value {
  if (modes.functionMode === 'error' && !(error instanceof FunctionDeclined)) {
    throw error;
  }
  return fallbackCall(name, args, modes, written, authored);
}

/** Keep the ordinary synchronous path allocation-free; attach recovery only to an async result. */
function recoverAsyncCall(
  result: MaybePromise<ValueGroup>,
  name: string,
  args: ValueGroup,
  modes: EvalModes,
  written?: WrittenArguments,
  authored?: readonly ArgumentKeyword[]
): MaybePromise<ValueGroup> {
  if (!isThenable(result)) {
    return result;
  }
  return result.catch(error => recoverCallFailure(error, name, args, modes, written, authored));
}

/**
 * The value→string hook supplied to Tier-B fns: a Quoted's INNER text (unquoted;
 * escaped `~"…"` already
 * arrives as an `Any` whose bytes ARE the inner text), any other value its
 * canonical emitted bytes. Boundary-clean (operates on the value domain only).
 */
const stringify = (v: ValueGroup): string =>
  !isValueGroupArray(v) && v.type === 'Quoted' ? v.value : emitValue(v);

/**
 * Build the typed `ValueEvaluator`. No pre-pass: values are computed
 * on demand during the single serialize walk. The fn set is CALLER-INJECTED via
 * `registry` (populate it from a DIALECT INDEX — `makeLessRegistry()` /
 * `makeSassRegistry()` in `@jesscss/fns`), so registration stays outside core.
 * Core imports no fn bodies here.
 *
 * `unitlessAdoptsUnit` is the dialect's arithmetic for a unitless `+`/`-`
 * operand against a united one (`4 + 3px`). Absent, the `unitMode` rule holds
 * (owner 2026-10-06, ledger P35): only `loose` computes it. A dialect whose own
 * semantics coerce (Sass: dart-sass `1 + 1px` → `2px`) passes `true`, and the
 * unitless side adopts the other's unit in every mode.
 */
export function buildEvaluator(registry: FnRegistry, options?: { readonly unitlessAdoptsUnit?: boolean }): ValueEvaluator {
  const call = (
    name: string,
    args: ValueGroup,
    modes: EvalModes,
    scope?: FnScope | null,
    io?: FnIo,
    scopedFn?: Fn,
    ambient = true,
    written?: WrittenArguments,
    authored?: readonly ArgumentKeyword[]
  ): MaybePromise<ValueGroup> => {
    /*
     * [plugin/P1] Scoped `@plugin`/`@use` fns shadow built-ins and are consulted
     * FIRST. The serializer normally passes an already-resolved `scopedFn`, so
     * the hot call path never repeats a lexical lookup. `scope` remains only for
     * direct consumers of the legacy lazy lookup seam.
     */
    const scoped = scopedFn ?? scope?.lookup(name);
    if (scoped) {
      try {
        return recoverAsyncCall(dispatchFn(scoped, args, { modes, stringify, io }), name, args, modes, written, authored);
      } catch (err) {
        return recoverCallFailure(err, name, args, modes, written, authored);
      }
    }
    if (ambient && registry.has(name)) {
      try {
        return recoverAsyncCall(registry.dispatch(name, args, { modes, stringify, io }), name, args, modes, written, authored);
      } catch (err) {
        /*
         * FunctionMode `preserve` (Less v5 default): a bare/global fn reference that
         * resolves to a built-in but can't produce a value for these args — a modern
         * color syntax (`hsl(198deg 28% 50%)`), a relative/`var()` color arg, or a
         * non-color first arg to `contrast`/`lighten` (the CSS filter) — renders
         * as-is, like an unknown CSS function, rather than throwing. This mirrors
         * less.js, which keeps such calls verbatim. (Only fn-dispatch errors are
         * caught here; variable-resolution / mixin-recursion errors are thrown
         * outside `dispatch` and still propagate.)
         */
        return recoverCallFailure(err, name, args, modes, written, authored);
      }
    }

    // Unknown function: emit verbatim.
    return fallbackCall(name, args, modes, written, authored);
  };

  /* The callee's declared parameter names — the binding surface a keyword
   * argument resolves against. Scoped fns shadow built-ins here exactly as they
   * do in `call`, so a call binds against the definition it will actually reach. */
  const paramNames = (name: string, scopedFn?: Fn, ambient = true): readonly (string | undefined)[] | undefined => {
    const fn = scopedFn ?? (ambient ? registry.get(name) : undefined);
    return fn === undefined ? undefined : fn.params.map(p => p.name);
  };

  /*
   * `unitMode` reaches comparison, not just arithmetic: `strictUnits` used to make
   * `1px + 3em` a hard error while `2px > 1em` stayed a silent `false`.
   */
  const compare = (op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean =>
    compareValues(op, left, right, modes.unitMode);

  const compareMatch = (op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean =>
    compareMatchValues(op, left, right, modes.unitMode);

  const typeCheck = (name: string, args: ValueGroup, _modes: EvalModes): boolean => {
    const values: Value[] = [];
    for (const value of groupItems(args)) {
      if (isValueGroupArray(value)) {
        return false;
      }
      values.push(value);
    }
    return typeCheckValues(name, values);
  };

  const dialectOperate = options?.unitlessAdoptsUnit === true
    ? (op: string, left: Value, right: Value, modes: EvalModes): Value => operate(op, left, right, modes, true)
    : operate;

  return { operate: dialectOperate, call, paramNames, has: name => registry.has(name), compare, compareMatch, typeCheck };
}
