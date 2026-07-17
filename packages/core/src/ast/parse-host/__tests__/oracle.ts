/**
 * The REAL evaluating oracle (front end, outside the tree2 boundary).
 *
 * The bare-context `renderNodeToString` oracle used through rung 7 does NOT
 * evaluate color/math functions — no function registry is wired into the bare
 * Context — so `lighten(...)`/`rgb(...)` fixtures were byte-identical only
 * because BOTH sides passed the call through un-evaluated. This oracle registers
 * the Less fns registry onto the parsed tree exactly as the less plugin does
 * (`tree.setFunctionBinding(name, new JsFunction(...))`), so functions are
 * genuinely computed. All rung-8 byte-identity is measured against THIS oracle.
 */

import * as lessFunctions from '@jesscss/fns';
import { Context } from '../../../context.js';
import { renderNodeToString } from '../../../tree/util/render-buffer.js';
import { JsFunction } from '../../../tree/index.js';
import type { Rules } from '../../../tree/index.js';

const COLLAPSE = { collapseNesting: true } as const;
const NESTED = { collapseNesting: false } as const;

/** Register the Less fns registry onto a parsed root (mirrors the less plugin). */
export function registerLessFunctions(root: Rules): void {
  for (const [key, value] of Object.entries(lessFunctions)) {
    if (typeof value !== 'function') continue;
    const runtimeName = (value as { name?: string }).name || key;
    root.setFunctionBinding(runtimeName, new JsFunction({ name: runtimeName, fn: value as never }));
  }
}

/**
 * Render a parsed Less tree through the REAL (function-evaluating) oracle. The
 * function registry is active, so color/math functions are computed.
 */
export async function renderRealOracle(tree: unknown): Promise<string> {
  const root = tree as Rules;
  const ctx = new Context();
  (ctx as unknown as { root: unknown }).root = root;
  registerLessFunctions(root);
  return await renderNodeToString(root as never, ctx, COLLAPSE);
}

/**
 * [nested/R0] Render through the REAL oracle in the Less v5 DEFAULT nested form
 * (`collapseNesting:false`) — the proxy for the intended-v5 nested goldens where
 * the legacy render agrees with them.
 */
export async function renderRealOracleNested(tree: unknown): Promise<string> {
  const root = tree as Rules;
  const ctx = new Context();
  (ctx as unknown as { root: unknown }).root = root;
  registerLessFunctions(root);
  return await renderNodeToString(root as never, ctx, NESTED);
}
