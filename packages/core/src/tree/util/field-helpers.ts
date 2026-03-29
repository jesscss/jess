import type { Node } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { EvalState } from '../../eval-state.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

/**
 * EvalState-based field read/write helpers.
 *
 * Architecture: single EvalState on context, with a stack for subtrees.
 *   Read:  activeState.peek(node)?.field ?? node.field
 *   Write: activeState.get(node).field = value
 *
 * No legacy fallbacks. No session. No instanceRoot.
 */

/**
 * Read a field from a node.
 * Resolution: activeState → canonical.
 */
export function getField<T = unknown>(
  node: Node,
  key: string,
  ctx: Context
): T {
  let state: EvalState | undefined = ctx.activeState;
  while (state) {
    const val = state.peek(node)?._fields?.get(key);
    if (val !== undefined) {
      return val as T;
    }
    state = state.parent;
  }
  return (node as unknown as Record<string, unknown>)[`_${key}`] as T;
}

/**
 * Write a field on a node. Routes through activeState.
 */
export function setField(
  node: Node,
  key: string,
  value: unknown,
  ctx: Context
): void {
  ctx.activeState.get(node).fields.set(key, value);
}

/**
 * Get the parent of a node.
 */
export function getParent(
  node: Node,
  ctx: Context
): Node | undefined {
  let state: EvalState | undefined = ctx.activeState;
  while (state) {
    const parent = state.peek(node)?._fields?.get('parent');
    if (parent !== undefined) {
      return parent as Node | undefined;
    }
    state = state.parent;
  }
  return node.parent;
}

/**
 * Set the parent of a node.
 */
export function setParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  ctx.activeState.get(node).fields.set('parent', parent);
}

/**
 * Check whether a node has been evaluated.
 */
export function isEvaluated(
  node: Node,
  ctx: Context
): boolean {
  return ctx.activeState.peek(node)?.evaluated ?? false;
}

/**
 * Mark a node as evaluated.
 */
export function setEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  ctx.activeState.get(node).evaluated = value;
}

/**
 * Check whether a node's preEval phase has completed.
 */
export function isPreEvaluated(
  node: Node,
  ctx: Context
): boolean {
  return ctx.activeState.peek(node)?.preEvaluated ?? false;
}

/**
 * Mark a node's preEval phase as completed.
 */
export function setPreEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  ctx.activeState.get(node).preEvaluated = value;
}

/**
 * Get the eval index of a node.
 */
export function getIndex(
  node: Node,
  ctx: Context
): number {
  const idx = ctx.activeState.peek(node)?._fields?.get('index');
  if (idx !== undefined) {
    return idx as number;
  }
  return node.index;
}

/**
 * Set the eval index of a node.
 */
export function setIndex(
  node: Node,
  index: number,
  ctx: Context
): void {
  ctx.activeState.get(node).fields.set('index', index);
}

/**
 * Get the source parent of a node.
 */
export function getSourceParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const sp = ctx.activeState.peek(node)?._fields?.get('sourceParent');
  if (sp !== undefined) {
    return sp as Node | undefined;
  }
  return node.sourceParent;
}

/**
 * Set the source parent of a node.
 */
export function setSourceParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  ctx.activeState.get(node).fields.set('sourceParent', parent);
}

/**
 * Bulk-set multiple runtime state fields on a node.
 */
export function setRuntimeState(
  node: Node,
  patch: Record<string, unknown>,
  ctx: Context
): void {
  const s = ctx.activeState.get(node);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'evaluated') {
      s.evaluated = value as boolean;
    } else if (key === 'preEvaluated') {
      s.preEvaluated = value as boolean;
    } else if (value !== undefined) {
      s.fields.set(key, value);
    }
  }
}

/**
 * Read the children array of a Rules node.
 */
export function getChildren(
  rules: Rules,
  ctx: Context
): readonly Node[] {
  return getField<readonly Node[]>(rules, 'value', ctx);
}

/**
 * Set the children array of a Rules node.
 */
export function setChildren(
  rules: Rules,
  nodes: readonly Node[],
  ctx: Context,
  options: { markDirty?: boolean } = {}
): void {
  ctx.activeState.get(rules).fields.set('value', [...nodes]);
  if (options.markDirty !== false) {
    markScopeDirty(rules, ctx);
  }
}

/**
 * Set a child at a specific index.
 */
export function setChildAt(
  rules: Rules,
  index: number,
  node: Node,
  ctx: Context,
  options: { markDirty?: boolean } = {}
): void {
  const s = ctx.activeState.get(rules);
  const currentChildren = s._fields?.get('value') as Node[] | undefined
    ?? [...rules._value];
  const prev = currentChildren[index];
  if (prev === node) {
    return;
  }
  currentChildren[index] = node;
  s.fields.set('value', currentChildren);
  if (options.markDirty !== false) {
    markScopeDirty(rules, ctx);
  }
}

/**
 * Append child nodes to a Rules node.
 */
export function appendChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const s = ctx.activeState.get(rules);
  const current = s._fields?.get('value') as Node[] | undefined
    ?? [...rules._value];
  s.fields.set('value', [...current, ...nodes]);
  markScopeDirty(rules, ctx);
}

/**
 * Prepend child nodes to a Rules node.
 */
export function prependChildren(
  rules: Rules,
  nodes: Node[],
  ctx: Context
): void {
  const s = ctx.activeState.get(rules);
  const current = s._fields?.get('value') as Node[] | undefined
    ?? [...rules._value];
  s.fields.set('value', [...nodes, ...current]);
  markScopeDirty(rules, ctx);
}

/**
 * Remove a child node from a Rules node.
 */
export function removeChild(
  rules: Rules,
  child: Node,
  ctx: Context
): void {
  const currentChildren = getChildren(rules, ctx);
  const idx = currentChildren.indexOf(child);
  if (idx >= 0) {
    const nextValue = [...currentChildren];
    nextValue.splice(idx, 1);
    ctx.activeState.get(rules).fields.set('value', nextValue);
    setParent(child, undefined, ctx);
    markScopeDirty(rules, ctx);
  }
}

/**
 * Replace a node with a replacement. Uses node patching on the activeState.
 */
export function replaceNode(
  node: Node,
  replacement: Node,
  ctx: Context
): void {
  ctx.activeState.get(node).replacement = replacement;
}

/**
 * Invalidate a Rules node's scope registry so the next lookup rebuilds it.
 */
export function markScopeDirty(
  _rules: Rules,
  _ctx: Context
): void {
  // Registry delta tracking removed with EvalSession.
  // Registry rebuilds from children on next access.
}

// --- Dependency tracking ---
// Stored as `_dependency` on NodeState (declare-only, zero cost when unused).

export interface EvalDependency {
  dependsOn: Set<import('../declaration-var.js').VarDeclaration> | null;
  sourceExpr?: Node;
}

export function getDependency(
  node: Node,
  ctx: Context
): EvalDependency | null {
  return ctx.activeState.resolve(node)?._dependency ?? null;
}

export function setDependency(
  node: Node,
  dependency: EvalDependency,
  ctx: Context
): void {
  ctx.activeState.get(node)._dependency = dependency;
}

export function isStatic(
  node: Node,
  ctx: Context
): boolean {
  const dep = getDependency(node, ctx);
  return !dep?.dependsOn || dep.dependsOn.size === 0;
}

export function mergeDependencies(
  nodes: readonly (Node | undefined)[],
  ctx: Context
): EvalDependency | null {
  let merged: Set<import('../declaration-var.js').VarDeclaration> | null = null;
  let sourceExpr: Node | undefined;
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    const dep = getDependency(node, ctx);
    if (dep?.dependsOn && dep.dependsOn.size > 0) {
      if (!merged) {
        merged = new Set(dep.dependsOn);
        sourceExpr = dep.sourceExpr;
      } else {
        for (const v of dep.dependsOn) {
          merged.add(v);
        }
      }
    }
  }
  return merged ? { dependsOn: merged, sourceExpr } : null;
}

/**
 * Check if a node is a top-level variable declaration.
 */
export function isTopLevelVarDeclaration(
  node: Node,
  ctx: Context
): node is import('../declaration-var.js').VarDeclaration {
  if (!isNode(node, N.VarDeclaration)) {
    return false;
  }
  const parent = getParent(node, ctx);
  return !!parent && isNode(parent, N.Rules) && parent === ctx.root;
}

// -- Changed variable tracking --
// Stored per-EvalState using a module-level WeakMap, so each push of an
// isolated state starts with an empty changed-vars set.

const changedVarsMap = new WeakMap<EvalState, Set<Node>>();

/**
 * Mark a VarDeclaration as changed in the current eval state.
 */
export function markChangedVar(ctx: Context, node: Node): void {
  const state = ctx.activeState;
  let set = changedVarsMap.get(state);
  if (!set) {
    set = new Set();
    changedVarsMap.set(state, set);
  }
  set.add(node);
}

/**
 * Check whether any vars have been marked as changed.
 */
export function hasChangedVars(ctx: Context): boolean {
  return (changedVarsMap.get(ctx.activeState)?.size ?? 0) > 0;
}

/**
 * Get the set of changed vars for the current eval state.
 */
export function getChangedVars(ctx: Context): Set<Node> | undefined {
  return changedVarsMap.get(ctx.activeState);
}
