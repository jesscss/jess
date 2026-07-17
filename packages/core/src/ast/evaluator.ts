/**
 * The `ValueEvaluator` seam implementation — boundary-clean, fully synchronous,
 * built entirely on the value domain (materialize + operate + kind-dispatch + free
 * serializer). This is the path that RETIRES the transitional adapter
 * (`parse-host/value-eval.ts`): no legacy `../tree` node, no reparse, no
 * `render()` walk, no async record/replay.
 *
 * Named calls dispatch through a caller-populated {@link FnRegistry}; every other
 * named call is treated as an unknown function emitted verbatim (byte-identical to
 * the adapter's unknown-fn path).
 *
 * HARD MODULE BOUNDARY: imports only the engine value modules.
 */
import type { EvalModes, List as ValueList, ValueEvaluator, ValueObj } from './value-eval.js';
import { operate, compare as compareValues, typeCheck as typeCheckValues } from './value-operate.js';
import { LiteralTag, materializeLiteral, sniffLiteral } from './literal-tag.js';
import { createFnRegistry } from './value-dispatch.js';
import { FN_LIST } from './functions/index.js';
import { makeKeyword } from './value-factory.js';

/** Join an unknown-fn's arg bytes exactly as the adapter does (per separator). */
function verbatimArgs(args: ValueList): string {
  const glue = args.sep === ',' ? ', ' : args.sep === '/' ? ' / ' : ' ';
  return args.items.map((a) => a.bytes).join(glue);
}

/**
 * The value→string host hook supplied to Tier-B fns — the twin of legacy
 * `serializeNodeValue`: a Quoted's INNER text (unquoted; escaped `~"…"` already
 * arrives as a `Keyword` whose bytes ARE the inner text), any other value its
 * canonical emitted bytes. Boundary-clean (operates on the value domain only).
 */
const stringify = (v: ValueObj): string => (v.kind === 'quoted' ? v.value : v.bytes);

/**
 * Build the synchronous typed `ValueEvaluator`. No pre-pass: values are computed
 * on demand during the single serialize walk. The built-in fns are registered up
 * front; a later stage can register them from `@jesscss/fns` instead.
 */
export function buildEvaluator(): ValueEvaluator {
  const registry = createFnRegistry();
  registry.registerAll(FN_LIST);

  const materialize = (bytes: string, tag?: LiteralTag): ValueObj =>
    tag !== undefined ? materializeLiteral(bytes, tag) : sniffLiteral(bytes);

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
