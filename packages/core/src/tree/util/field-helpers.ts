import { CANONICAL, EVAL, type Node } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { addEdgeAt, addParentEdge, removeParentEdge } from './cursor.js';

export function getParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const renderKey = ctx.renderKey
    ?? ctx.rulesContext?.renderKey
    ?? (node.renderKey !== CANONICAL ? node.renderKey : undefined)
    ?? (node.parentEdges?.has(EVAL) ? EVAL : undefined);
  if (renderKey !== undefined) {
    const parent = node.parentEdges?.get(renderKey);
    if (parent !== undefined) {
      return parent;
    }
  }
  return node.parent;
}

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
  ctx: Context
): Node | undefined {
  const edge = (node as unknown as { sourceParentEdge?: Map<unknown, Node | undefined> }).sourceParentEdge;
  const renderKey = ctx.renderKey
    ?? ctx.rulesContext?.renderKey
    ?? (node.renderKey !== CANONICAL ? node.renderKey : undefined)
    ?? (edge?.has(EVAL) ? EVAL : undefined);
  if (renderKey !== undefined) {
    if (edge?.has(renderKey)) {
      return edge.get(renderKey);
    }
  }
  if (edge?.has(CANONICAL)) {
    return edge.get(CANONICAL);
  }
  return node.sourceParent;
}

export function setSourceParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  const renderKey = ctx.renderKey ?? ctx.rulesContext?.renderKey ?? node.renderKey;
  if (renderKey !== undefined) {
    const edgeOwner = node as unknown as { sourceParentEdge?: Map<unknown, Node | undefined> };
    const edge = edgeOwner.sourceParentEdge ?? new Map<unknown, Node | undefined>();
    edge.set(renderKey, parent);
    edgeOwner.sourceParentEdge = edge;
    return;
  }
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
  const resolvedRenderKey = ctx.renderKey ?? rules.renderKey;
  const renderKey = resolvedRenderKey === CANONICAL ? undefined : resolvedRenderKey;
  if (renderKey !== undefined && rules.renderKey !== undefined && rules.renderKey === renderKey) {
    const previous = rules.value;
    (rules as unknown as { _setValueArray(value: Node[]): void })._setValueArray([...nodes]);
    for (const child of previous) {
      if (!nodes.includes(child)) {
        removeParentEdge(child, renderKey);
      }
    }
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index]!;
      addEdgeAt(rules, 'value', index, renderKey, node);
      addParentEdge(node, renderKey, rules);
    }
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  if (renderKey === undefined) {
    (rules as unknown as { _setValueArray(value: Node[]): void })._setValueArray([...nodes]);
    for (const node of nodes) {
      rules.adopt(node, ctx);
    }
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  const previous = rules.get('value', ctx);
  for (const child of previous) {
    if (!nodes.includes(child)) {
      removeParentEdge(child, renderKey);
    }
  }
  nodes.forEach((node, index) => {
    addEdgeAt(rules, 'value', index, renderKey, node);
    addParentEdge(node, renderKey, rules);
  });
  if (options.markDirty !== false) {
    markScopeDirty(rules, ctx);
  }
}

export function setChildAt(
  rules: Rules,
  index: number,
  node: Node,
  ctx: Context,
  options: { markDirty?: boolean } = {}
): void {
  const resolvedRenderKey = ctx.renderKey ?? rules.renderKey;
  const renderKey = resolvedRenderKey === CANONICAL ? undefined : resolvedRenderKey;
  if (renderKey !== undefined) {
    if (rules.renderKey !== undefined && rules.renderKey === renderKey) {
      const currentChildren = rules.value;
      if (currentChildren[index] === node) {
        return;
      }
      const previous = currentChildren[index];
      const nextValue = [...currentChildren];
      nextValue[index] = node;
      (rules as unknown as { _setValueArray(value: Node[]): void })._setValueArray(nextValue);
      if (previous && previous !== node) {
        removeParentEdge(previous, renderKey);
      }
      addEdgeAt(rules, 'value', index, renderKey, node);
      addParentEdge(node, renderKey, rules);
      if (options.markDirty !== false) {
        markScopeDirty(rules, ctx);
      }
      return;
    }
    const currentChildren = rules.get('value', ctx);
    if (currentChildren[index] === node) {
      return;
    }
    const previous = currentChildren[index];
    if (previous && previous !== node) {
      removeParentEdge(previous, renderKey);
    }
    addEdgeAt(rules, 'value', index, renderKey, node);
    addParentEdge(node, renderKey, rules);
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  const currentChildren = [...rules.value];
  const prev = currentChildren[index];
  if (prev === node) {
    return;
  }
  currentChildren[index] = node;
  (rules as unknown as { _setValueArray(value: Node[]): void })._setValueArray(currentChildren);
  rules.adopt(node, ctx);
  if (options.markDirty !== false) {
    markScopeDirty(rules, ctx);
  }
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
