/**
 * The `ValueEvaluator` seam implementation — boundary-clean, synchronous on the
 * ordinary path and awaitable only when an injected fn capability needs it,
 * built entirely on the value domain (materialize + operate + kind-dispatch + free
 * serializer): no legacy `../tree` node, no reparse, no `render()` walk, no async
 * record/replay.
 *
 * Named calls dispatch through a caller-populated {@link FnRegistry}; every other
 * named call is treated as an unknown function emitted verbatim.
 *
 * HARD MODULE BOUNDARY: imports only the engine value modules.
 */
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { emitValue, isValueGroupArray, type EvalModes, type FnScope, type ValueEvaluator, type ValueGroup, type ValueObj } from './value-eval.js';
import type { FnIo } from './functions/types.js';
import { sepGlue } from './value-eval.js';
import { groupItems, groupSeparator } from './value-list.js';
import { operate } from './value-operate.js';
import { compare as compareValues, typeCheck as typeCheckValues } from './value-guards.js';
import { sniffLiteral } from './literal-tag.js';
import type { FnRegistry } from './value-dispatch.js';
import { dispatchFn } from './value-dispatch.js';
import { makeKeyword } from './value-factory.js';

/** Join an unknown-fn's arg bytes verbatim (per separator). */
function verbatimArgs(args: ValueGroup): string {
  const separator = groupSeparator(args);
  return groupItems(args).map(emitValue).join(separator === ' ' ? ' ' : sepGlue(separator));
}

/** Preserve an optional CSS call after name resolution or invocation failed. */
function fallbackCall(name: string, args: ValueGroup): ValueObj {
  return makeKeyword(`${name}(${verbatimArgs(args)})`);
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
  onUnresolved: ((error: unknown) => void) | undefined
): ValueObj {
  if (modes.functionMode === 'error') {
    throw error;
  }
  onUnresolved?.(error);
  return fallbackCall(name, args);
}

/** Keep the ordinary synchronous path allocation-free; attach recovery only to an async result. */
function recoverAsyncCall(
  result: MaybePromise<ValueGroup>,
  name: string,
  args: ValueGroup,
  modes: EvalModes,
  onUnresolved: ((error: unknown) => void) | undefined
): MaybePromise<ValueGroup> {
  if (!isThenable(result)) {
    return result;
  }
  return result.catch(error => recoverCallFailure(error, name, args, modes, onUnresolved));
}

/**
 * The value→string hook supplied to Tier-B fns: a Quoted's INNER text (unquoted;
 * escaped `~"…"` already
 * arrives as a `Keyword` whose bytes ARE the inner text), any other value its
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
 */
export function buildEvaluator(registry: FnRegistry): ValueEvaluator {
  const materialize = (bytes: string): ValueObj => sniffLiteral(bytes);

  const call = (
    name: string,
    args: ValueGroup,
    modes: EvalModes,
    scope?: FnScope | null,
    io?: FnIo,
    onUnresolved?: (error: unknown) => void
  ): MaybePromise<ValueGroup> => {
    // [plugin/P1] Scoped `@plugin`/`@use` fns shadow built-ins and are consulted
    // FIRST — but ONLY when `scope` is non-null, which the caller passes solely
    // when the document registered a scoped fn somewhere (`e.anyScopedFns`). On the
    // idle path `scope` is omitted/null and this whole branch is skipped, so the
    // built-in dispatch below is reached on the identical path it took before.
    if (scope) {
      const scoped = scope.lookup(name);
      if (scoped) {
        try {
          return recoverAsyncCall(dispatchFn(scoped, args, { modes, stringify, io }), name, args, modes, onUnresolved);
        } catch (err) {
          return recoverCallFailure(err, name, args, modes, onUnresolved);
        }
      }
    }
    if (registry.has(name)) {
      try {
        return recoverAsyncCall(registry.dispatch(name, args, { modes, stringify, io }), name, args, modes, onUnresolved);
      } catch (err) {
        // FunctionMode `preserve` (Less v5 default): a bare/global fn reference that
        // resolves to a built-in but can't produce a value for these args — a modern
        // color syntax (`hsl(198deg 28% 50%)`), a relative/`var()` color arg, or a
        // non-color first arg to `contrast`/`lighten` (the CSS filter) — renders
        // as-is, like an unknown CSS function, rather than throwing. This mirrors
        // less.js, which keeps such calls verbatim. (Only fn-dispatch errors are
        // caught here; variable-resolution / mixin-recursion errors are thrown
        // outside `dispatch` and still propagate.)
        return recoverCallFailure(err, name, args, modes, onUnresolved);
      }
    }
    // Unknown function: emit verbatim.
    return fallbackCall(name, args);
  };

  const compare = (op: string, left: ValueGroup, right: ValueGroup, modes: EvalModes): boolean =>
    compareValues(op, left, right, modes.equalityMode ?? 'less');

  const typeCheck = (name: string, args: ValueGroup, _modes: EvalModes): boolean => {
    const values: ValueObj[] = [];
    for (const value of groupItems(args)) {
      if (isValueGroupArray(value)) {
        return false;
      }
      values.push(value);
    }
    return typeCheckValues(name, values);
  };

  return { materialize, operate, call, compare, typeCheck };
}
