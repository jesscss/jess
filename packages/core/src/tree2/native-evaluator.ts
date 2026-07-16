/**
 * NATIVE implementation of tree2's `ValueEvaluator` seam — boundary-clean, fully
 * synchronous, built entirely on the tree2 value domain (materialize + operate +
 * kind-dispatch + free serializer). This is the path that RETIRES the transitional
 * adapter (`tree2-frontend/value-eval.ts`): no legacy `../tree` node, no reparse,
 * no `render()` walk, no async record/replay.
 *
 * For the FOUNDATION it wires the 3 converted fns (`lighten`/`percentage`/`e`)
 * through the dispatch table; every other named call is treated as an unknown
 * function emitted verbatim (byte-identical to the adapter's unknown-fn path).
 * The remaining ~50 fns are the NEXT wave — a call to one of those is NOT yet
 * covered here (it would emit verbatim), so the differential is scoped to cases
 * that don't need them.
 *
 * HARD MODULE BOUNDARY: imports only the tree2 value modules.
 */
import type { EvalModes, List as ValueList, ValueEvaluator, ValueObj } from './value-eval.js';
import { nativeOperate, nativeGuardCmp, nativeGuardCall } from './value-operate.js';
import { LiteralTag, materializeLiteral, sniffLiteral } from './literal-tag.js';
import { dispatchNative, hasNativeFn } from './value-dispatch.js';
import { makeKeyword } from './value-factory.js';

/** Join an unknown-fn's arg bytes exactly as the adapter does (per separator). */
function verbatimArgs(args: ValueList): string {
  const glue = args.sep === ',' ? ', ' : args.sep === '/' ? ' / ' : ' ';
  return args.items.map((a) => a.bytes).join(glue);
}

/**
 * The value→string host hook supplied to native Tier-B fns — the tree2 twin of
 * legacy `serializeNodeValue`: a Quoted's INNER text (unquoted; escaped `~"…"`
 * already arrives as a `Keyword` whose bytes ARE the inner text), any other value
 * its canonical emitted bytes. Boundary-clean (operates on the value domain only).
 */
const stringify = (v: ValueObj): string => (v.kind === 'quoted' ? v.value : v.bytes);

/**
 * Build the native synchronous typed `ValueEvaluator`. No pre-pass: values are
 * computed on demand during the single serialize walk.
 */
export function buildNativeEvaluator(): ValueEvaluator {
  const materialize = (bytes: string, tag?: LiteralTag): ValueObj =>
    tag !== undefined ? materializeLiteral(bytes, tag) : sniffLiteral(bytes);

  const operate = (op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj =>
    nativeOperate(op, left, right, modes);

  const call = (name: string, args: ValueList, modes: EvalModes): ValueObj => {
    if (hasNativeFn(name)) return dispatchNative(name, args, { modes, stringify });
    // Unknown function: emit verbatim (byte-identical to the adapter).
    return makeKeyword(`${name}(${verbatimArgs(args)})`);
  };

  const guardCmp = (op: string, left: ValueObj, right: ValueObj, _modes: EvalModes): boolean =>
    nativeGuardCmp(op, left, right);

  const guardCall = (name: string, args: ValueList, _modes: EvalModes): boolean =>
    nativeGuardCall(name, args.items);

  return { materialize, operate, call, guardCmp, guardCall };
}
