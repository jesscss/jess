/**
 * The `ValueEvaluator` seam implementation — boundary-clean, fully synchronous,
 * built entirely on the value domain (materialize + operate + kind-dispatch + free
 * serializer). This is the path that REPLACED the transitional adapter (formerly
 * `parse-host/value-eval.ts`, now deleted): no legacy `../tree` node, no reparse, no
 * `render()` walk, no async record/replay.
 *
 * Named calls dispatch through a caller-populated {@link FnRegistry}; every other
 * named call is treated as an unknown function emitted verbatim (byte-identical to
 * the former adapter's unknown-fn path).
 *
 * HARD MODULE BOUNDARY: imports only the engine value modules.
 */
import type { EvalModes, FnScope, List as ValueList, ValueEvaluator, ValueObj } from './value-eval.js';
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
 * The value→string host hook supplied to Tier-B fns — the twin of legacy
 * `serializeNodeValue`: a Quoted's INNER text (unquoted; escaped `~"…"` already
 * arrives as a `Keyword` whose bytes ARE the inner text), any other value its
 * canonical emitted bytes. Boundary-clean (operates on the value domain only).
 */
const stringify = (v: ValueObj): string => (v.type === 'Quoted' ? v.value : v.bytes);

/**
 * Build the synchronous typed `ValueEvaluator`. No pre-pass: values are computed
 * on demand during the single serialize walk. The fn set is CALLER-INJECTED via
 * `registry` (populate it with `makeBuiltinRegistry()` for the built-in set), so a
 * later stage can register fns from `@jesscss/fns` without touching this module.
 * Core imports no fn bodies here.
 */
export function buildEvaluator(registry: FnRegistry): ValueEvaluator {
  const materialize = (bytes: string): ValueObj => sniffLiteral(bytes);

  const call = (name: string, args: ValueList, modes: EvalModes, scope?: FnScope | null): ValueObj => {
    // [plugin/P1] Scoped `@plugin`/`@use` fns shadow built-ins and are consulted
    // FIRST — but ONLY when `scope` is non-null, which the caller passes solely
    // when the document registered a scoped fn somewhere (`e.anyScopedFns`). On the
    // idle path `scope` is omitted/null and this whole branch is skipped, so the
    // built-in dispatch below is reached on the identical path it took before.
    if (scope) {
      const scoped = scope.lookup(name);
      if (scoped) {
        try {
          return dispatchFn(scoped, args, { modes, stringify });
        } catch (err) {
          if (err instanceof RangeError) throw err;
          return makeKeyword(`${name}(${verbatimArgs(args)})`);
        }
      }
    }
    if (registry.has(name)) {
      try {
        return registry.dispatch(name, args, { modes, stringify });
      } catch (err) {
        // FunctionMode `preserve` (Less v5 default): a bare/global fn reference that
        // resolves to a built-in but can't produce a value for these args — a modern
        // color syntax (`hsl(198deg 28% 50%)`), a relative/`var()` color arg, or a
        // non-color first arg to `contrast`/`lighten` (the CSS filter) — renders
        // as-is, like an unknown CSS function, rather than throwing. This mirrors
        // less.js, which keeps such calls verbatim. (Only fn-dispatch errors are
        // caught here; variable-resolution / mixin-recursion errors are thrown
        // outside `dispatch` and still propagate.)
        if (err instanceof RangeError) throw err;
        return makeKeyword(`${name}(${verbatimArgs(args)})`);
      }
    }
    // Unknown function: emit verbatim (byte-identical to the adapter).
    return makeKeyword(`${name}(${verbatimArgs(args)})`);
  };

  const compare = (op: string, left: ValueObj, right: ValueObj, _modes: EvalModes): boolean =>
    compareValues(op, left, right);

  const typeCheck = (name: string, args: ValueList, _modes: EvalModes): boolean =>
    typeCheckValues(name, args.items);

  return { materialize, operate, call, compare, typeCheck };
}
