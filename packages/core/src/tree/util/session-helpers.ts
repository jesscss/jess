import type { Node } from '../node-base.js';
import type { EvalSession } from '../../eval-session.js';
import type { Context } from '../../context.js';

/**
 * Session-aware field read/write helpers.
 *
 * These functions provide a uniform interface for reading and writing
 * node fields that respects the active EvalSession on Context. When
 * a session exists, reads check session patches first; writes go to
 * the session overlay instead of mutating the canonical node. When
 * no session exists, they fall through to direct field access — so
 * existing behavior is preserved exactly.
 *
 * Introduced in Stage 7 but not yet wired into any production code
 * path. Stages 8-13 will incrementally replace direct field access
 * with these helpers.
 */

/**
 * Read a field from a node, checking session patches first.
 * Falls through to the node's own field when no session exists
 * or the field is unpatched.
 */
export function sessionGetField<T = unknown>(
  node: Node,
  key: string,
  ctx: Context
): T {
  const session: EvalSession | undefined = (ctx as any).session;
  if (session && session.hasField(node, key)) {
    return session.getField(node, key) as T;
  }
  return (node as any)[key];
}

/**
 * Write a field on a node. If a session exists, the write goes to
 * the session overlay; otherwise it mutates the node directly.
 */
export function sessionPatchField(
  node: Node,
  key: string,
  value: unknown,
  ctx: Context
): void {
  const session: EvalSession | undefined = (ctx as any).session;
  if (session) {
    session.patchField(node, key, value);
  } else {
    (node as any)[key] = value;
  }
}

/**
 * Get the parent of a node, respecting session runtime state.
 */
export function sessionGetParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const session: EvalSession | undefined = (ctx as any).session;
  if (session && session.hasRuntime(node)) {
    const runtime = session.getRuntime(node);
    if (runtime.parent !== undefined) {
      return runtime.parent;
    }
  }
  return node.parent;
}

/**
 * Set the parent of a node in the session, or directly if no session.
 */
export function sessionSetParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  const session: EvalSession | undefined = (ctx as any).session;
  if (session) {
    session.getRuntime(node).parent = parent;
  } else {
    if (parent) {
      parent.adopt(node);
    } else {
      (node as any).parent = undefined;
    }
  }
}

/**
 * Check whether a node has been evaluated in this session.
 */
export function sessionIsEvaluated(
  node: Node,
  ctx: Context
): boolean {
  const session: EvalSession | undefined = (ctx as any).session;
  if (session && session.hasRuntime(node)) {
    const runtime = session.getRuntime(node);
    if (runtime.evaluated !== undefined) {
      return runtime.evaluated;
    }
  }
  return node.evaluated;
}

/**
 * Mark a node as evaluated in this session.
 */
export function sessionSetEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  const session: EvalSession | undefined = (ctx as any).session;
  if (session) {
    session.getRuntime(node).evaluated = value;
  } else {
    node.evaluated = value;
  }
}
