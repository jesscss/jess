import type { Node } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { EvalDependency, RuntimeState, SessionInstanceRoot } from '../../eval-session.js';
import type { VarDeclaration } from '../declaration-var.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

/**
 * @deprecated — Legacy helper, to be removed. Use position directly.
 */
function resolveInstanceRoot(node: Node, ctx: Context): SessionInstanceRoot | undefined {
  return ctx.instanceRoot ?? node._instanceRoot;
}

/**
 * Position-aware field read/write helpers.
 *
 * Architecture: two layers only.
 *   Read:  position.getField(node, key) ?? node[key]
 *   Write: context.ensurePosition().setField(node, key, value)
 *
 * Legacy layers (instanceRoot, session) are preserved temporarily in
 * getField for backward compatibility during migration but will be
 * removed. setField and setParent already route through position only.
 */

/**
 * Read a field from a node.
 * Resolution: position → canonical.
 * (Legacy: instanceRoot and session fallbacks still present during migration.)
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
  // Carried position (mixin/function output remembers its call's patches)
  const carried = node._evalPosition;
  if (carried && carried.hasField(node, key)) {
    return carried.getField(node, key) as T;
  }
  // Legacy: instanceRoot fallback — to be removed
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasField(node, key)) {
    return ir.getField(node, key) as T;
  }
  // Legacy: session fallback — to be removed
  const session = ctx.session;
  if (session && session.hasField(node, key)) {
    return session.getField(node, key) as T;
  }
  return (node as unknown as Record<string, unknown>)[key] as T;
}

/**
 * Write a field on a node. Always routes through position.
 * `ensurePosition()` lazily creates one if needed.
 * Never falls through to canonical mutation.
 */
export function setField(
  node: Node,
  key: string,
  value: unknown,
  ctx: Context
): void {
  ctx.ensurePosition().setField(node, key, value);
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
 * Get the parent of a node. Resolution: position → instanceRoot → session → canonical.
 */
export function getParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const pos = ctx.position;
  if (pos && pos.hasField(node, 'parent')) {
    return pos.getField(node, 'parent') as Node | undefined;
  }
  // Legacy: instanceRoot fallback — to be removed
  const ir = resolveInstanceRoot(node, ctx);
  if (ir && ir.hasRuntime(node)) {
    const runtime = ir.getShadow(node)!.runtime!;
    if (Object.prototype.hasOwnProperty.call(runtime, 'parent')) {
      return runtime.parent;
    }
  }
  // Legacy: session fallback — to be removed
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
 * Set the parent of a node. Always routes through position.
 */
export function setParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  ctx.ensurePosition().setField(node, 'parent', parent);
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
 * Mark a node as evaluated. Always routes through position.
 */
export function setEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  ctx.ensurePosition().setField(node, '_evaluated', value);
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
 * Mark a node's preEval phase as completed. Always routes through position.
 */
export function setPreEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  ctx.ensurePosition().setField(node, '_preEvaluated', value);
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
 * Set the eval index of a node. Always routes through position.
 */
export function setIndex(
  node: Node,
  index: number,
  ctx: Context
): void {
  ctx.ensurePosition().setField(node, 'index', index);
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
 * Set the source parent of a node. Always routes through position.
 */
export function setSourceParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  ctx.ensurePosition().setField(node, 'sourceParent', parent);
}

/**
 * Bulk-set multiple runtime state fields on a node. Always routes through position.
 */
export function setRuntimeState(
  node: Node,
  patch: Partial<RuntimeState>,
  ctx: Context
): void {
  const pos = ctx.ensurePosition();
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined || Object.prototype.hasOwnProperty.call(patch, key)) {
      pos.setField(node, key, value);
    }
  }
}

/**
 * Read the children array of a Rules node.
 * Resolution: position → canonical.
 */
export function getChildren(
  rules: Rules,
  ctx: Context
): readonly Node[] {
  const pos = ctx.position;
  if (pos && pos.hasField(rules, 'value')) {
    return pos.getField(rules, 'value') as Node[];
  }
  return rules.value;
}

type SessionChildrenWriteOptions = {
  markDirty?: boolean;
};

/**
 * Set the children array of a Rules node. Always routes through position.
 */
export function setChildren(
  rules: Rules,
  nodes: readonly Node[],
  ctx: Context,
  options: SessionChildrenWriteOptions = {}
): void {
  ctx.ensurePosition().setField(rules, 'value', [...nodes]);
  if (options.markDirty !== false) {
    markScopeDirty(rules, ctx);
  }
}

/**
 * Set a child at a specific index. Always routes through position.
 */
export function setChildAt(
  rules: Rules,
  index: number,
  node: Node,
  ctx: Context,
  options: SessionChildrenWriteOptions = {}
): void {
  const pos = ctx.ensurePosition();
  const currentChildren = pos.hasField(rules, 'value')
    ? pos.getField(rules, 'value') as Node[]
    : [...rules.value];
  const prev = currentChildren[index];
  if (prev === node) {
    return;
  }
  currentChildren[index] = node;
  pos.setField(rules, 'value', currentChildren);
  if (options.markDirty !== false) {
    markScopeDirty(rules, ctx);
  }
}

/**
 * Append child nodes to a Rules node. Always routes through position.
 */
export function appendChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const pos = ctx.ensurePosition();
  const current = pos.hasField(rules, 'value')
    ? pos.getField(rules, 'value') as Node[]
    : [...rules.value];
  pos.setField(rules, 'value', [...current, ...nodes]);
  markScopeDirty(rules, ctx);
}

/**
 * Prepend child nodes to a Rules node. Always routes through position.
 */
export function prependChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const pos = ctx.ensurePosition();
  const current = pos.hasField(rules, 'value')
    ? pos.getField(rules, 'value') as Node[]
    : [...rules.value];
  pos.setField(rules, 'value', [...nodes, ...current]);
  markScopeDirty(rules, ctx);
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
