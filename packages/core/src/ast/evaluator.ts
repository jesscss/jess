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
import type { EvalModes, FnScope, List as ValueList, ValueEvaluator, ValueObj } from './value-eval.js';
import type { FnIo } from './functions/types.js';
import { sepGlue } from './value-eval.js';
import { operate } from './value-operate.js';
import { compare as compareValues, typeCheck as typeCheckValues } from './value-guards.js';
import { sniffLiteral } from './literal-tag.js';
import type { FnRegistry } from './value-dispatch.js';
import { dispatchFn } from './value-dispatch.js';
import { makeKeyword } from './value-factory.js';

/** Join an unknown-fn's arg bytes verbatim (per separator). */
function verbatimArgs(args: ValueList): string {
  return args.items.map((a) => a.bytes).join(sepGlue(args.sep));
}

/**
 * The value→string hook supplied to Tier-B fns: a Quoted's INNER text (unquoted;
 * escaped `~"…"` already
 * arrives as a `Keyword` whose bytes ARE the inner text), any other value its
 * canonical emitted bytes. Boundary-clean (operates on the value domain only).
 */
const stringify = (v: ValueObj): string => (v.type === 'Quoted' ? v.value : v.bytes);

/**
 * Build the typed `ValueEvaluator`. No pre-pass: values are computed
 * on demand during the single serialize walk. The fn set is CALLER-INJECTED via
 * `registry` (populate it with `makeBuiltinRegistry()` for the built-in set), so a
 * later stage can register fns from `@jesscss/fns` without touching this module.
 * Core imports no fn bodies here.
 */
export function buildEvaluator(registry: FnRegistry): ValueEvaluator {
  const materialize = (bytes: string): ValueObj => sniffLiteral(bytes);

  const call = (
    name: string,
    args: ValueList,
    modes: EvalModes,
    scope?: FnScope | null,
    io?: FnIo,
    onUnresolved?: (error: unknown) => void,
  ): MaybePromise<ValueObj> => {
    const fallback = () => makeKeyword(`${name}(${verbatimArgs(args)})`);
    const recover = (result: MaybePromise<ValueObj>): MaybePromise<ValueObj> => {
      if (!isThenable(result)) return result;
      return result.catch(err => {
        if (err instanceof RangeError || modes.functionMode === 'error') throw err;
        onUnresolved?.(err);
        return fallback();
      });
    };
    // [plugin/P1] Scoped `@plugin`/`@use` fns shadow built-ins and are consulted
    // FIRST — but ONLY when `scope` is non-null, which the caller passes solely
    // when the document registered a scoped fn somewhere (`e.anyScopedFns`). On the
    // idle path `scope` is omitted/null and this whole branch is skipped, so the
    // built-in dispatch below is reached on the identical path it took before.
    if (scope) {
      const scoped = scope.lookup(name);
      if (scoped) {
        try {
          return recover(dispatchFn(scoped, args, { modes, stringify, io }));
        } catch (err) {
          if (err instanceof RangeError || modes.functionMode === 'error') throw err;
          onUnresolved?.(err);
          return fallback();
        }
      }
    }
    if (registry.has(name)) {
      try {
        return recover(registry.dispatch(name, args, { modes, stringify, io }));
      } catch (err) {
        // FunctionMode `preserve` (Less v5 default): a bare/global fn reference that
        // resolves to a built-in but can't produce a value for these args — a modern
        // color syntax (`hsl(198deg 28% 50%)`), a relative/`var()` color arg, or a
        // non-color first arg to `contrast`/`lighten` (the CSS filter) — renders
        // as-is, like an unknown CSS function, rather than throwing. This mirrors
        // less.js, which keeps such calls verbatim. (Only fn-dispatch errors are
        // caught here; variable-resolution / mixin-recursion errors are thrown
        // outside `dispatch` and still propagate.)
        if (err instanceof RangeError || modes.functionMode === 'error') throw err;
        onUnresolved?.(err);
        return fallback();
      }
    }
    // Unknown function: emit verbatim.
    return fallback();
  };

  const compare = (op: string, left: ValueObj, right: ValueObj, modes: EvalModes): boolean =>
    compareValues(op, left, right, modes.equalityMode ?? 'less');

  const typeCheck = (name: string, args: ValueList, _modes: EvalModes): boolean =>
    typeCheckValues(name, args.items);

  return { materialize, operate, call, compare, typeCheck };
}
