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
import type { EvalModes, List as ValueList, ValueEvaluator, ValueObj } from './value-eval.js';
import { sepGlue } from './value-eval.js';
import { operate } from './value-operate.js';
import { compare as compareValues, typeCheck as typeCheckValues } from './value-guards.js';
import { LiteralTag, type LitFields, materializeLiteral, sniffLiteral } from './literal-tag.js';
import type { FnRegistry } from './value-dispatch.js';
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
  const materialize = (bytes: string, tag?: LiteralTag, lit?: LitFields): ValueObj =>
    tag !== undefined ? materializeLiteral(bytes, tag, lit) : sniffLiteral(bytes);

  const call = (name: string, args: ValueList, modes: EvalModes): ValueObj => {
    if (registry.has(name)) return registry.dispatch(name, args, { modes, stringify });
    // Unknown function: emit verbatim (byte-identical to the adapter).
    return makeKeyword(`${name}(${verbatimArgs(args)})`);
  };

  const compare = (op: string, left: ValueObj, right: ValueObj, _modes: EvalModes): boolean =>
    compareValues(op, left, right);

  const typeCheck = (name: string, args: ValueList, _modes: EvalModes): boolean =>
    typeCheckValues(name, args.items);

  return { materialize, operate, call, compare, typeCheck };
}
