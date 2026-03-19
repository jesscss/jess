import type { Node } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { RuntimeState } from '../../eval-session.js';

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
  const session = ctx.session;
  if (session && session.hasField(node, key)) {
    return session.getField(node, key) as T;
  }
  return (node as unknown as Record<string, unknown>)[key] as T;
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
  const session = ctx.session;
  if (session) {
    session.patchField(node, key, value);
  } else {
    (node as unknown as Record<string, unknown>)[key] = value;
  }
}

/**
 * Get the parent of a node, respecting session runtime state.
 */
export function sessionGetParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const session = ctx.session;
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
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).parent = parent;
  } else {
    if (parent) {
      parent.adopt(node);
    } else {
      (node as unknown as Record<string, unknown>).parent = undefined;
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
  const session = ctx.session;
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
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).evaluated = value;
  } else {
    node.evaluated = value;
  }
}

/**
 * Check whether a node's preEval phase has completed in this session.
 */
export function sessionIsPreEvaluated(
  node: Node,
  ctx: Context
): boolean {
  const session = ctx.session;
  if (session && session.hasRuntime(node)) {
    const runtime = session.getRuntime(node);
    if (runtime.preEvaluated !== undefined) {
      return runtime.preEvaluated;
    }
  }
  return node.preEvaluated;
}

/**
 * Mark a node's preEval phase as completed in this session.
 */
export function sessionSetPreEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).preEvaluated = value;
  } else {
    node.preEvaluated = value;
  }
}

/**
 * Get the eval index of a node, respecting session runtime state.
 */
export function sessionGetIndex(
  node: Node,
  ctx: Context
): number {
  const session = ctx.session;
  if (session && session.hasRuntime(node)) {
    const runtime = session.getRuntime(node);
    if (runtime.index !== undefined) {
      return runtime.index;
    }
  }
  return node.index;
}

/**
 * Set the eval index of a node in the session, or directly if no session.
 */
export function sessionSetIndex(
  node: Node,
  index: number,
  ctx: Context
): void {
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).index = index;
  } else {
    node.index = index;
  }
}

/**
 * Get the source parent of a node, respecting session runtime state.
 */
export function sessionGetSourceParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const session = ctx.session;
  if (session && session.hasRuntime(node)) {
    const runtime = session.getRuntime(node);
    if (runtime.sourceParent !== undefined) {
      return runtime.sourceParent;
    }
  }
  return node.sourceParent;
}

/**
 * Set the source parent of a node in the session, or directly if no session.
 */
export function sessionSetSourceParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).sourceParent = parent;
  } else {
    node.sourceParent = parent;
  }
}

/**
 * Bulk-set multiple runtime state fields on a node.
 * Routes through session when active; falls back to direct mutation.
 */
export function sessionSetRuntimeState(
  node: Node,
  patch: Partial<RuntimeState>,
  ctx: Context
): void {
  const session = ctx.session;
  if (session) {
    const runtime = session.getRuntime(node);
    if (patch.parent !== undefined) {
      runtime.parent = patch.parent;
    }
    if (patch.index !== undefined) {
      runtime.index = patch.index;
    }
    if (patch.evaluated !== undefined) {
      runtime.evaluated = patch.evaluated;
    }
    if (patch.preEvaluated !== undefined) {
      runtime.preEvaluated = patch.preEvaluated;
    }
    if (patch.sourceParent !== undefined) {
      runtime.sourceParent = patch.sourceParent;
    }
    if (patch.sourceNode !== undefined) {
      runtime.sourceNode = patch.sourceNode;
    }
  } else {
    if (patch.parent !== undefined) {
      patch.parent.adopt(node);
    }
    if (patch.index !== undefined) {
      node.index = patch.index;
    }
    if (patch.evaluated !== undefined) {
      node.evaluated = patch.evaluated;
    }
    if (patch.preEvaluated !== undefined) {
      node.preEvaluated = patch.preEvaluated;
    }
    if (patch.sourceParent !== undefined) {
      node.sourceParent = patch.sourceParent;
    }
    if (patch.sourceNode !== undefined) {
      node.sourceNode = patch.sourceNode;
    }
  }
}

/**
 * Read the children array of a Rules node.
 * Falls through to rules.value. Session-local children are introduced in Stage 9.
 */
export function sessionGetChildren(
  rules: Rules,
  _ctx: Context
): readonly Node[] {
  return rules.value;
}

/**
 * Append child nodes to a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function sessionAppendChildren(
  rules: Rules,
  nodes: Node[],
  _ctx: Context
): void {
  rules.push(...nodes);
}

/**
 * Prepend child nodes to a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function sessionPrependChildren(
  rules: Rules,
  nodes: Node[],
  _ctx: Context
): void {
  rules.unshift(...nodes);
}

/**
 * Remove a child node from a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function sessionRemoveChild(
  rules: Rules,
  child: Node,
  _ctx: Context
): void {
  const idx = rules.value.indexOf(child);
  if (idx >= 0) {
    rules.splice(idx, 1);
  }
}

/**
 * Replace a node with a replacement in its parent Rules.
 * Stage 9 will store this in the session overlay rather than mutating directly.
 */
export function sessionReplaceNode(
  node: Node,
  replacement: Node,
  ctx: Context
): void {
  if (ctx.session) {
    // Stage 9+: store replacement in session overlay instead of mutating.
    // For now, fall through to direct mutation.
  }
  const parent = node.parent;
  if (parent) {
    const arr = (parent as unknown as { value?: Node[] }).value;
    if (Array.isArray(arr)) {
      const idx = arr.indexOf(node);
      if (idx >= 0) {
        arr[idx] = replacement;
        parent.adopt(replacement);
      }
    }
  }
}

/**
 * Invalidate a Rules node's scope registry so the next lookup rebuilds it.
 * Stage 9 will make this session-local when session-local children are active.
 */
export function sessionMarkScopeDirty(
  _rules: Rules,
  _ctx: Context
): void {
  // No-op until session-local children are introduced in Stage 9.
  // At that point, this will clear the session-local registry snapshot.
}
