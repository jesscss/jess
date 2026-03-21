import type { Node } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { EvalDependency, RuntimeState } from '../../eval-session.js';
import type { VarDeclaration } from '../declaration-var.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

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

export function sessionGetDependency(
  node: Node,
  ctx: Context
): EvalDependency | null {
  const session = ctx.session;
  if (!session || !session.hasDependency(node)) {
    return null;
  }
  return session.getDependency(node) ?? null;
}

export function sessionSetDependency(
  node: Node,
  dependency: EvalDependency,
  ctx: Context
): void {
  const session = ctx.session;
  if (!session) {
    return;
  }
  session.setDependency(node, dependency);
}

export function sessionIsStatic(
  node: Node,
  ctx: Context
): boolean {
  const dependency = sessionGetDependency(node, ctx);
  return !dependency?.dependsOn || dependency.dependsOn.size === 0;
}

export function sessionMergeDependencies(
  nodes: readonly (Node | undefined)[],
  ctx: Context
): EvalDependency | null {
  if (!ctx.session) {
    return null;
  }

  let dependsOn: Set<VarDeclaration> | null = null;
  let sourceExpr: Node | undefined;

  for (const node of nodes) {
    if (!node) {
      continue;
    }
    const dependency = sessionGetDependency(node, ctx);
    if (!dependency?.dependsOn || dependency.dependsOn.size === 0) {
      continue;
    }
    dependsOn ??= new Set<VarDeclaration>();
    for (const varDecl of dependency.dependsOn) {
      dependsOn.add(varDecl);
    }
    sourceExpr ??= dependency.sourceExpr;
  }

  if (!dependsOn || dependsOn.size === 0) {
    return null;
  }

  return { dependsOn, sourceExpr };
}

export function isTopLevelVarDeclaration(
  node: Node,
  ctx: Context
): node is VarDeclaration {
  if (!isNode(node, N.VarDeclaration)) {
    return false;
  }
  const parent = sessionGetParent(node, ctx);
  return !!parent && isNode(parent, N.Rules) && parent === ctx.root;
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
    if (Object.prototype.hasOwnProperty.call(runtime, 'parent')) {
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
    if (Object.prototype.hasOwnProperty.call(runtime, 'sourceParent')) {
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
    if (Object.prototype.hasOwnProperty.call(patch, 'parent')) {
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
    if (Object.prototype.hasOwnProperty.call(patch, 'sourceParent')) {
      runtime.sourceParent = patch.sourceParent;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sourceNode')) {
      runtime.sourceNode = patch.sourceNode;
    }
  } else {
    if (Object.prototype.hasOwnProperty.call(patch, 'parent')) {
      if (patch.parent) {
        patch.parent.adopt(node);
      } else {
        (node as unknown as Record<string, unknown>).parent = undefined;
      }
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
    if (Object.prototype.hasOwnProperty.call(patch, 'sourceParent')) {
      node.sourceParent = patch.sourceParent;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sourceNode')) {
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
  ctx: Context
): readonly Node[] {
  const session = ctx.session;
  if (session) {
    return session.getChildren(rules) ?? rules.value;
  }
  return rules.value;
}

type SessionChildrenWriteOptions = {
  markDirty?: boolean;
};

export function sessionSetChildren(
  rules: Rules,
  nodes: readonly Node[],
  ctx: Context,
  options: SessionChildrenWriteOptions = {}
): void {
  const session = ctx.session;
  if (session) {
    const prevChildren = sessionGetChildren(rules, ctx);
    const nextChildren = [...nodes];
    const nextSet = new Set(nextChildren);
    session.setChildren(rules, nextChildren);
    for (const child of prevChildren) {
      if (!nextSet.has(child)) {
        sessionSetParent(child, undefined, ctx);
      }
    }
    for (const child of nextChildren) {
      sessionSetParent(child, rules, ctx);
    }
    if (options.markDirty !== false) {
      sessionMarkScopeDirty(rules, ctx);
    }
    return;
  }
  rules.setData([...nodes]);
}

export function sessionSetChildAt(
  rules: Rules,
  index: number,
  node: Node,
  ctx: Context,
  options: SessionChildrenWriteOptions = {}
): void {
  const session = ctx.session;
  if (session) {
    const currentChildren = sessionGetChildren(rules, ctx);
    const prev = currentChildren[index];
    if (prev === node) {
      return;
    }
    const nextChildren = [...currentChildren];
    nextChildren[index] = node;
    session.setChildren(rules, nextChildren);
    sessionSetParent(node, rules, ctx);
    if (prev) {
      sessionSetParent(prev, undefined, ctx);
    }
    if (options.markDirty !== false) {
      sessionMarkScopeDirty(rules, ctx);
    }
    return;
  }
  rules.setData(index, node);
}

/**
 * Append child nodes to a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function sessionAppendChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const session = ctx.session;
  if (session) {
    const nextValue = [...sessionGetChildren(rules, ctx), ...nodes];
    session.setChildren(rules, nextValue);
    for (const node of nodes) {
      sessionSetParent(node, rules, ctx);
    }
    sessionMarkScopeDirty(rules, ctx);
    return;
  }
  rules.push(ctx, ...nodes);
}

/**
 * Prepend child nodes to a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function sessionPrependChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const session = ctx.session;
  if (session) {
    const nextValue = [...nodes, ...sessionGetChildren(rules, ctx)];
    session.setChildren(rules, nextValue);
    for (const node of nodes) {
      sessionSetParent(node, rules, ctx);
    }
    sessionMarkScopeDirty(rules, ctx);
    return;
  }
  rules.unshift(ctx, ...nodes);
}

/**
 * Remove a child node from a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function sessionRemoveChild(
  rules: Rules,
  child: Node,
  ctx: Context
): void {
  const currentChildren = sessionGetChildren(rules, ctx);
  const idx = currentChildren.indexOf(child);
  if (idx >= 0) {
    if (ctx.session) {
      const nextValue = [...currentChildren];
      nextValue.splice(idx, 1);
      ctx.session.setChildren(rules, nextValue);
      sessionSetParent(child, undefined, ctx);
      sessionMarkScopeDirty(rules, ctx);
      return;
    }
    rules.splice(ctx, idx, 1);
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
    const parent = sessionGetParent(node, ctx);
    if (parent && isNode(parent, N.Rules)) {
      const currentChildren = sessionGetChildren(parent, ctx);
      const idx = currentChildren.indexOf(node);
      if (idx >= 0) {
        const nextValue = [...currentChildren];
        nextValue[idx] = replacement;
        ctx.session.setChildren(parent, nextValue);
        sessionSetParent(replacement, parent, ctx);
        sessionSetParent(node, undefined, ctx);
        sessionMarkScopeDirty(parent, ctx);
        return;
      }
    }
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
  rules: Rules,
  ctx: Context
): void {
  ctx.session?.clearRegistryDelta(rules);
}
