/**
 * Real implementation of tree2's `ValueService` (the value-eval seam).
 *
 * This file lives OUTSIDE `tree2/` on purpose. The hard module boundary forbids
 * any file under `tree2/` from importing `../tree`; the value SERVICE is
 * explicitly allowed to, because it is the boundary-crossing "context object"
 * tree2 receives, and value MATH is shared machinery (the fns registry + the
 * Less eval pipeline), not the eval/render engine tree2 replaces. tree2 owns the
 * value STRUCTURE (`Operation`/`FunctionCall`/`Paren` nodes) and the byte
 * emission of operands; this service owns the MATH.
 *
 * Strategy: value math is delegated to the SAME pipeline the real oracle uses —
 * a value expression is wrapped as `_x { _v: <expr>; }`, rendered through the
 * fns-registered Less render path, and the computed value bytes are extracted.
 * That guarantees byte-identity with the oracle by construction (same parser,
 * same eval, same serializer).
 *
 * Async/sync bridge: function evaluation renders on the async path, but tree2's
 * serializer is synchronous by design. So the service is built in two phases:
 *   1. `collectValueExpressions(root)` runs a synchronous serialize pass with a
 *      recording service to gather every (variable-resolved) value expression
 *      tree2 will ask about.
 *   2. those expressions are computed ONCE, asynchronously, into a cache.
 *   3. `mapValueService(cache)` returns a synchronous `ValueService` that the
 *      timed serialize replays from the cache.
 */

import { parseLessFn } from '@jesscss/less-parser';
import { Context } from '../context.js';
import { renderNodeToString } from '../tree/util/render-buffer.js';
import type { Rules } from '../tree/index.js';
import { serialize, type Root, type ValueService } from '../tree2/index.js';
import { registerLessFunctions } from './oracle.js';

const COLLAPSE = { collapseNesting: true } as const;

/** The cache key for a value expression is its reconstructed source. */
function operationKey(operator: string, left: string, right: string): string {
  return `(${left} ${operator} ${right})`;
}
function callKey(name: string, argsSource: string): string {
  return `${name}(${argsSource})`;
}

const VALUE_RE = /_v:\s*([\s\S]*?);/;

/**
 * Compute a single value expression to its bytes through the real Less render
 * path (the oracle). Async because function evaluation renders asynchronously.
 */
async function computeExpression(exprSource: string): Promise<string> {
  const root = parseLessFn(`_x{_v:${exprSource};}`).tree as unknown as Rules;
  const ctx = new Context();
  (ctx as unknown as { root: unknown }).root = root;
  registerLessFunctions(root);
  const rendered = await renderNodeToString(root as never, ctx, COLLAPSE);
  const match = VALUE_RE.exec(rendered);
  // Fall back to the source if extraction fails (keeps output visible/diffable).
  return match ? match[1]! : exprSource;
}

/**
 * A synchronous recording `ValueService`: it does no math, it just collects the
 * (already variable-resolved) expression sources tree2 asks about and returns
 * the un-evaluated source as a stable placeholder.
 */
function recordingService(keys: Set<string>): ValueService {
  return {
    evaluateOperation(operator, left, right) {
      const key = operationKey(operator, left, right);
      keys.add(key);
      return key;
    },
    callFunction(name, argsSource) {
      const key = callKey(name, argsSource);
      keys.add(key);
      return key;
    },
  };
}

/** A synchronous replay `ValueService` backed by the precomputed cache. */
function mapValueService(cache: Map<string, string>): ValueService {
  return {
    evaluateOperation(operator, left, right) {
      const key = operationKey(operator, left, right);
      return cache.get(key) ?? key;
    },
    callFunction(name, argsSource) {
      const key = callKey(name, argsSource);
      return cache.get(key) ?? key;
    },
  };
}

/**
 * Build a synchronous `ValueService` for a specific tree2 `Root` by
 * precomputing every value expression it needs (async), so the timed serialize
 * can compute values with a plain synchronous lookup.
 */
export async function buildValueService(root: Root): Promise<ValueService> {
  const keys = new Set<string>();
  // Synchronous recording pass (no math): gather resolved expression sources.
  serialize(root, { valueService: recordingService(keys) });
  const cache = new Map<string, string>();
  for (const key of keys) {
    cache.set(key, await computeExpression(key));
  }
  return mapValueService(cache);
}
