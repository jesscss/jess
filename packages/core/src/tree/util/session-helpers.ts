import type { Node } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { EvalDependency, RuntimeState, SessionInstanceRoot } from '../../eval-session.js';
import type { VarDeclaration } from '../declaration-var.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

/**
 * Resolve the active instance root for a node.
 * Priority: ctx.instanceRoot → node._instanceRoot → undefined.
 */
function resolveInstanceRoot(node: Node, ctx: Context): SessionInstanceRoot | undefined {
  return ctx.instanceRoot ?? node._instanceRoot;
}

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
 * Read a field from a node.
 * Resolution: position → instanceRoot → session → canonical.
 */
export function getField<T = unknown>(
  node: Node,
  key: string,
  ctx: Context
): T {
  const pos = ctx.position;
  if (pos && pos.hasField(node, key)) {
    return pos.getField(node, key) as T;
  }
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasField(node, key)) {
    return ir.getField(node, key) as T;
  }
  const session = ctx.session;
  if (session && session.hasField(node, key)) {
    return session.getField(node, key) as T;
  }
  return (node as unknown as Record<string, unknown>)[key] as T;
}

/**
 * Write a field on a node.
 * Write target: position → instanceRoot → session → canonical.
 */
export function patchField(
  node: Node,
  key: string,
  value: unknown,
  ctx: Context
): void {
  const pos = ctx.position;
  if (pos) {
    pos.patchField(node, key, value);
    return;
  }
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    ir.patchField(node, key, value);
    return;
  }
  const session = ctx.session;
  if (session) {
    session.patchField(node, key, value);
  } else {
    (node as unknown as Record<string, unknown>)[key] = value;
  }
}

export function getDependency(
  node: Node,
  ctx: Context
): EvalDependency | null {
  const session = ctx.session;
  if (!session || !session.hasDependency(node)) {
    return null;
  }
  return session.getDependency(node) ?? null;
}

export function setDependency(
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

export function isStatic(
  node: Node,
  ctx: Context
): boolean {
  const dependency = getDependency(node, ctx);
  return !dependency?.dependsOn || dependency.dependsOn.size === 0;
}

export function mergeDependencies(
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
    const dependency = getDependency(node, ctx);
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
  const parent = getParent(node, ctx);
  return !!parent && isNode(parent, N.Rules) && parent === ctx.root;
}

/**
 * Get the parent of a node. Resolution: instanceRoot → session → canonical.
 */
export function getParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasRuntime(node)) {
    const runtime = ir.getShadow(node)!.runtime!;
    if (Object.prototype.hasOwnProperty.call(runtime, 'parent')) {
      return runtime.parent;
    }
  }
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
 * Set the parent of a node. Write target: instanceRoot → session → canonical.
 */
export function setParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    ir.getRuntime(node).parent = parent;
    return;
  }
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
 * Check whether a node has been evaluated. Resolution: instanceRoot → session → canonical.
 */
export function isEvaluated(
  node: Node,
  ctx: Context
): boolean {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasRuntime(node)) {
    const runtime = ir.getShadow(node)!.runtime!;
    if (runtime.evaluated !== undefined) {
      return runtime.evaluated;
    }
  }
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
 * Mark a node as evaluated. Write target: instanceRoot → session → canonical.
 */
export function setEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    ir.getRuntime(node).evaluated = value;
    return;
  }
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).evaluated = value;
  } else {
    node.evaluated = value;
  }
}

/**
 * Check whether a node's preEval phase has completed. Resolution: instanceRoot → session → canonical.
 */
export function isPreEvaluated(
  node: Node,
  ctx: Context
): boolean {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasRuntime(node)) {
    const runtime = ir.getShadow(node)!.runtime!;
    if (runtime.preEvaluated !== undefined) {
      return runtime.preEvaluated;
    }
  }
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
 * Mark a node's preEval phase as completed. Write target: instanceRoot → session → canonical.
 */
export function setPreEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    ir.getRuntime(node).preEvaluated = value;
    return;
  }
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).preEvaluated = value;
  } else {
    node.preEvaluated = value;
  }
}

/**
 * Get the eval index of a node. Resolution: instanceRoot → session → canonical.
 */
export function getIndex(
  node: Node,
  ctx: Context
): number {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasRuntime(node)) {
    const runtime = ir.getShadow(node)!.runtime!;
    if (runtime.index !== undefined) {
      return runtime.index;
    }
  }
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
 * Set the eval index of a node. Write target: instanceRoot → session → canonical.
 */
export function setIndex(
  node: Node,
  index: number,
  ctx: Context
): void {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    ir.getRuntime(node).index = index;
    return;
  }
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).index = index;
  } else {
    node.index = index;
  }
}

/**
 * Get the source parent of a node. Resolution: instanceRoot → session → canonical.
 */
export function getSourceParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasRuntime(node)) {
    const runtime = ir.getShadow(node)!.runtime!;
    if (Object.prototype.hasOwnProperty.call(runtime, 'sourceParent')) {
      return runtime.sourceParent;
    }
  }
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
 * Set the source parent of a node. Write target: instanceRoot → session → canonical.
 */
export function setSourceParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    ir.getRuntime(node).sourceParent = parent;
    return;
  }
  const session = ctx.session;
  if (session) {
    session.getRuntime(node).sourceParent = parent;
  } else {
    node.sourceParent = parent;
  }
}

/**
 * Bulk-set multiple runtime state fields on a node.
 * Write target: instanceRoot → session → canonical.
 */
export function setRuntimeState(
  node: Node,
  patch: Partial<RuntimeState>,
  ctx: Context
): void {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    const runtime = ir.getRuntime(node);
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
    return;
  }
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
 * Resolution: instanceRoot → session → canonical (rules.value).
 */
export function getChildren(
  rules: Rules,
  ctx: Context
): readonly Node[] {
  const ir = resolveInstanceRoot(rules, ctx);
  if (ir) {
    return ir.getChildren(rules) ?? rules.value;
  }
  const session = ctx.session;
  if (session) {
    return session.getChildren(rules) ?? rules.value;
  }
  return rules.value;
}

type SessionChildrenWriteOptions = {
  markDirty?: boolean;
};

export function setChildren(
  rules: Rules,
  nodes: readonly Node[],
  ctx: Context,
  options: SessionChildrenWriteOptions = {}
): void {
  const ir = resolveInstanceRoot(rules, ctx);
  if (ir) {
    const prevChildren = getChildren(rules, ctx);
    const nextChildren = [...nodes];
    const nextSet = new Set(nextChildren);
    ir.setChildren(rules, nextChildren);
    for (const child of prevChildren) {
      if (!nextSet.has(child)) {
        setParent(child, undefined, ctx);
      }
    }
    for (const child of nextChildren) {
      setParent(child, rules, ctx);
    }
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  const session = ctx.session;
  if (session) {
    const prevChildren = getChildren(rules, ctx);
    const nextChildren = [...nodes];
    const nextSet = new Set(nextChildren);
    session.setChildren(rules, nextChildren);
    for (const child of prevChildren) {
      if (!nextSet.has(child)) {
        setParent(child, undefined, ctx);
      }
    }
    for (const child of nextChildren) {
      setParent(child, rules, ctx);
    }
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  rules.setData([...nodes]);
}

export function setChildAt(
  rules: Rules,
  index: number,
  node: Node,
  ctx: Context,
  options: SessionChildrenWriteOptions = {}
): void {
  const ir = resolveInstanceRoot(rules, ctx);
  if (ir) {
    const currentChildren = getChildren(rules, ctx);
    const prev = currentChildren[index];
    if (prev === node) {
      return;
    }
    const nextChildren = [...currentChildren];
    nextChildren[index] = node;
    ir.setChildren(rules, nextChildren);
    setParent(node, rules, ctx);
    if (prev) {
      setParent(prev, undefined, ctx);
    }
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  const session = ctx.session;
  if (session) {
    const currentChildren = getChildren(rules, ctx);
    const prev = currentChildren[index];
    if (prev === node) {
      return;
    }
    const nextChildren = [...currentChildren];
    nextChildren[index] = node;
    session.setChildren(rules, nextChildren);
    setParent(node, rules, ctx);
    if (prev) {
      setParent(prev, undefined, ctx);
    }
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  rules.setData(index, node);
}

/**
 * Append child nodes to a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function appendChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const ir = resolveInstanceRoot(rules, ctx);
  if (ir) {
    const nextValue = [...getChildren(rules, ctx), ...nodes];
    ir.setChildren(rules, nextValue);
    for (const node of nodes) {
      setParent(node, rules, ctx);
    }
    markScopeDirty(rules, ctx);
    return;
  }
  const session = ctx.session;
  if (session) {
    const nextValue = [...getChildren(rules, ctx), ...nodes];
    session.setChildren(rules, nextValue);
    for (const node of nodes) {
      setParent(node, rules, ctx);
    }
    markScopeDirty(rules, ctx);
    return;
  }
  rules.push(ctx, ...nodes);
}

/**
 * Prepend child nodes to a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function prependChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const ir = resolveInstanceRoot(rules, ctx);
  if (ir) {
    const nextValue = [...nodes, ...getChildren(rules, ctx)];
    ir.setChildren(rules, nextValue);
    for (const node of nodes) {
      setParent(node, rules, ctx);
    }
    markScopeDirty(rules, ctx);
    return;
  }
  const session = ctx.session;
  if (session) {
    const nextValue = [...nodes, ...getChildren(rules, ctx)];
    session.setChildren(rules, nextValue);
    for (const node of nodes) {
      setParent(node, rules, ctx);
    }
    markScopeDirty(rules, ctx);
    return;
  }
  rules.unshift(ctx, ...nodes);
}

/**
 * Remove a child node from a Rules node.
 * Stage 9 will route into session-local children when a session is active.
 */
export function removeChild(
  rules: Rules,
  child: Node,
  ctx: Context
): void {
  const currentChildren = getChildren(rules, ctx);
  const idx = currentChildren.indexOf(child);
  if (idx >= 0) {
    const ir = resolveInstanceRoot(rules, ctx);
    if (ir) {
      const nextValue = [...currentChildren];
      nextValue.splice(idx, 1);
      ir.setChildren(rules, nextValue);
      setParent(child, undefined, ctx);
      markScopeDirty(rules, ctx);
      return;
    }
    if (ctx.session) {
      const nextValue = [...currentChildren];
      nextValue.splice(idx, 1);
      ctx.session.setChildren(rules, nextValue);
      setParent(child, undefined, ctx);
      markScopeDirty(rules, ctx);
      return;
    }
    rules.splice(ctx, idx, 1);
  }
}

/**
 * Replace a node with a replacement in its parent Rules.
 * Write target: instanceRoot → session → canonical.
 */
export function replaceNode(
  node: Node,
  replacement: Node,
  ctx: Context
): void {
  const ir = resolveInstanceRoot(node, ctx);
  if (ir) {
    const parent = getParent(node, ctx);
    if (parent && isNode(parent, N.Rules)) {
      const currentChildren = getChildren(parent, ctx);
      const idx = currentChildren.indexOf(node);
      if (idx >= 0) {
        const nextValue = [...currentChildren];
        nextValue[idx] = replacement;
        ir.setChildren(parent, nextValue);
        setParent(replacement, parent, ctx);
        setParent(node, undefined, ctx);
        markScopeDirty(parent, ctx);
        return;
      }
    }
  }
  if (ctx.session) {
    const parent = getParent(node, ctx);
    if (parent && isNode(parent, N.Rules)) {
      const currentChildren = getChildren(parent, ctx);
      const idx = currentChildren.indexOf(node);
      if (idx >= 0) {
        const nextValue = [...currentChildren];
        nextValue[idx] = replacement;
        ctx.session.setChildren(parent, nextValue);
        setParent(replacement, parent, ctx);
        setParent(node, undefined, ctx);
        markScopeDirty(parent, ctx);
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
export function markScopeDirty(
  rules: Rules,
  ctx: Context
): void {
  ctx.session?.clearRegistryDelta(rules);
}
