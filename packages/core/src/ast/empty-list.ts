/*
 * An empty list has no CSS spelling (ledger P51; Dart Sass: "() isn't a valid
 * CSS value"), so written where CSS needs a value it fails the compile rather
 * than writing nothing in its place (P37). Apart from the serializer so it
 * stays one reviewable size.
 */
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import type { Block, FunctionCall, Reference, ValueSlot } from './nodes.js';
import { isEmptyList, type EvalValue } from './value-eval.js';

type Site = { readonly context: Context | undefined };

/** What an escaped Block writes: its value, unless it is the empty list (`()`, `.jess` `{}`), which fails. */
export function writtenListValue(node: Block, s: Site): ValueSlot {
  if (Array.isArray(node.value) && node.value.length === 0) {
    throw ERR.emptyListValue({ node, ...callSiteLocation(node, s), meta: { reason: 'An empty list (`()`, `.jess` `{}`) has no CSS spelling.' } });
  }
  return node.value;
}

/** A call's or a reference's result written as a value in `.scss` and `.jess`: an empty list fails. */
export function writtenResult(value: EvalValue, node: FunctionCall | Reference, s: Site): EvalValue {
  if (typeof value !== 'string' && isEmptyList(value)) {
    throw ERR.emptyListValue({ node, ...callSiteLocation(node, s), meta: { reason: `\`${node.type === 'FunctionCall' ? `${node.name}()` : node.raw}\` is an empty list, which has no CSS spelling.` } });
  }
  return value;
}
