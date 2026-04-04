import { CANONICAL, EVAL, type Node, type RenderKey } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { addEdgeAt, addParentEdge, removeParentEdge } from './cursor.js';

function getParentEdgeRenderKeys(
  node: Node,
  ctx: Context,
  edge?: Map<unknown, Node | undefined>
): unknown[] {
  const keys: unknown[] = [];
  const push = (key: unknown): void => {
    if (key === undefined || key === CANONICAL || keys.includes(key)) {
      return;
    }
    keys.push(key);
  };
  push(ctx.renderKey);
  push(ctx.rulesContext?.renderKey);
  push(node.renderKey);
  if (edge?.has(EVAL)) {
    push(EVAL);
  }
  return keys;
}

function setRulesValueArray(rules: Rules, nodes: Node[]): void {
  const mutableRules = rules as Rules & { _setValueArray?: (nodes: Node[]) => void };
  if (typeof mutableRules._setValueArray !== 'function') {
    throw new Error('Rules is missing _setValueArray');
  }
  mutableRules._setValueArray(nodes);
}

type ChildWriteTarget =
  | {
    kind: 'canonical';
    currentChildren: readonly Node[];
  }
  | {
    kind: 'wrapper';
    renderKey: RenderKey;
    currentChildren: readonly Node[];
  }
  | {
    kind: 'overlay';
    renderKey: RenderKey;
    currentChildren: readonly Node[];
  };

function resolveChildWriteTarget(
  rules: Rules,
  ctx: Context
): ChildWriteTarget {
  const resolvedRenderKey = ctx.renderKey ?? rules.renderKey;
  const renderKey = resolvedRenderKey === CANONICAL ? undefined : resolvedRenderKey;
  if (renderKey === undefined) {
    return {
      kind: 'canonical',
      currentChildren: rules.value
    };
  }
  if (rules.renderKey !== undefined && rules.renderKey === renderKey) {
    return {
      kind: 'wrapper',
      renderKey,
      currentChildren: rules.value
    };
  }
  return {
    kind: 'overlay',
    renderKey,
    currentChildren: rules.get('value', ctx)
  };
}

function maybeMarkScopeDirty(
  rules: Rules,
  ctx: Context,
  options: { markDirty?: boolean }
): void {
  if (options.markDirty !== false) {
    markScopeDirty(rules, ctx);
  }
}

function connectRenderChildren(
  rules: Rules,
  nodes: readonly Node[],
  renderKey: RenderKey
): void {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    addEdgeAt(rules, 'value', index, renderKey, node);
    addParentEdge(node, renderKey, rules);
  }
}

function disconnectMissingRenderChildren(
  previous: readonly Node[],
  next: readonly Node[],
  renderKey: RenderKey
): void {
  for (const child of previous) {
    if (!next.includes(child)) {
      removeParentEdge(child, renderKey);
    }
  }
}

/**
 * Resolve the effective parent for the current render placement.
 *
 * Node graph invariants:
 * - `node.parent` stores the canonical fallback parent.
 * - `node.parentEdges` stores placement-specific parent overrides keyed by render key.
 * - callers should treat this as the primary upward traversal surface when rebuilding
 *   the current render path (for example, reconstructing the active Ruleset / AtRule frames).
 * - secondary lookup lanes such as `CALLER` are intentionally not followed here; they are
 *   opt-in traversal choices layered on top of the primary parent walk.
 */
export function getParent(
  node: Node,
  ctx: Context
): Node | undefined {
  for (const renderKey of getParentEdgeRenderKeys(node, ctx, node.parentEdges)) {
    const parent = node.parentEdges?.get(renderKey);
    if (parent !== undefined) {
      return parent;
    }
  }
  return node.parent;
}

/**
 * Write the primary parent for a node.
 *
 * For canonical writes this mutates `node.parent`.
 * For render-keyed writes this records a placement override in `node.parentEdges`
 * without disturbing canonical parentage.
 *
 * This should be the default way eval/adoption code captures the "current frame"
 * onto emitted nodes. If later serialization needs to guess the parent from text,
 * the real bug is usually that `setParent(...)` was not called with the correct
 * render placement when the node was created.
 */
export function setParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  if (ctx.renderKey !== undefined && ctx.renderKey !== CANONICAL) {
    if (parent) {
      addParentEdge(node, ctx.renderKey, parent);
    } else {
      removeParentEdge(node, ctx.renderKey);
    }
    return;
  }
  node.parent = parent;
}

export function isEvaluated(
  node: Node,
  _ctx: Context
): boolean {
  return node.evaluated;
}

export function setEvaluated(
  node: Node,
  value: boolean,
  _ctx: Context
): void {
  node.evaluated = value;
}

export function isPreEvaluated(
  node: Node,
  _ctx: Context
): boolean {
  return node.preEvaluated;
}

export function setPreEvaluated(
  node: Node,
  value: boolean,
  _ctx: Context
): void {
  node.preEvaluated = value;
}

export function getIndex(
  node: Node,
  _ctx: Context
): number {
  return node.index;
}

export function setIndex(
  node: Node,
  index: number,
  _ctx: Context
): void {
  node.index = index;
}

export function getSourceParent(
  node: Node,
  _ctx: Context
): Node | undefined {
  return node.sourceParent;
}

export function setSourceParent(
  node: Node,
  parent: Node | undefined,
  _ctx: Context
): void {
  node.sourceParent = parent;
}

export function getChildren(
  rules: Rules,
  ctx: Context
): readonly Node[] {
  return rules.get('value', ctx);
}

export function setChildren(
  rules: Rules,
  nodes: readonly Node[],
  ctx: Context,
  options: { markDirty?: boolean } = {}
): void {
  const target = resolveChildWriteTarget(rules, ctx);
  if (target.kind === 'canonical') {
    setRulesValueArray(rules, [...nodes]);
    for (const node of nodes) {
      rules.adopt(node, ctx);
    }
    maybeMarkScopeDirty(rules, ctx, options);
    return;
  }
  if (target.kind === 'wrapper') {
    setRulesValueArray(rules, [...nodes]);
  }
  disconnectMissingRenderChildren(target.currentChildren, nodes, target.renderKey);
  connectRenderChildren(rules, nodes, target.renderKey);
  maybeMarkScopeDirty(rules, ctx, options);
}

export function setChildAt(
  rules: Rules,
  index: number,
  node: Node,
  ctx: Context,
  options: { markDirty?: boolean } = {}
): void {
  const target = resolveChildWriteTarget(rules, ctx);
  if (target.kind !== 'canonical') {
    if (target.currentChildren[index] === node) {
      return;
    }
    const previous = target.currentChildren[index];
    if (target.kind === 'wrapper') {
      const nextValue = [...target.currentChildren];
      nextValue[index] = node;
      setRulesValueArray(rules, nextValue);
    }
    if (previous && previous !== node) {
      removeParentEdge(previous, target.renderKey);
    }
    addEdgeAt(rules, 'value', index, target.renderKey, node);
    addParentEdge(node, target.renderKey, rules);
    maybeMarkScopeDirty(rules, ctx, options);
    return;
  }
  const currentChildren = [...target.currentChildren];
  const prev = currentChildren[index];
  if (prev === node) {
    return;
  }
  currentChildren[index] = node;
  setRulesValueArray(rules, currentChildren);
  rules.adopt(node, ctx);
  maybeMarkScopeDirty(rules, ctx, options);
}

export function markScopeDirty(
  _rules: Rules,
  _ctx: Context
): void {
  // Registry delta tracking removed with EvalSession.
  // Registry rebuilds from children on next access.
}

export interface EvalDependency {
  dependsOn: Set<import('../declaration-var.js').VarDeclaration> | null;
  sourceExpr?: Node;
}

export function getDependency(
  node: Node,
  ctx: Context
): EvalDependency | null {
  return ctx.dependencyMap.get(node) ?? null;
}

export function setDependency(
  node: Node,
  dependency: EvalDependency,
  ctx: Context
): void {
  ctx.dependencyMap.set(node, dependency);
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
