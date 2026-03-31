import { EVAL, type Node } from '../node-base.js';
import type { Context } from '../../context.js';
import type { Rules } from '../rules.js';
import type { EvalState } from '../../eval-state.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { addEdgeAt, addParentEdge, removeParentEdge } from './cursor.js';

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
  return (node as unknown as Record<string, unknown>)[key] as T;
}

export function setField(
  node: Node,
  key: string,
  value: unknown,
  ctx: Context
): void {
  if (ctx.renderKey !== undefined) {
    const childKeys = (node.constructor as { childKeys?: readonly string[] | null }).childKeys;
    if (childKeys?.includes(key) && isNode(value)) {
      const record = node as unknown as Record<string, unknown>;
      const edgeKey = `${key}Edge`;
      const edge = (record[edgeKey] as Map<object | symbol, Node> | undefined) ?? new Map<object | symbol, Node>();
      const previous = (edge.get(ctx.renderKey) as Node | undefined)
        ?? (record[key] as Node | undefined);
      if (previous && previous !== value) {
        removeParentEdge(previous, ctx.renderKey);
      }
      edge.set(ctx.renderKey, value);
      record[edgeKey] = edge;
      addParentEdge(value, ctx.renderKey, node);
      return;
    }
  }
  ctx.activeState.get(node).fields.set(key, value);
}

export function getParent(
  node: Node,
  ctx: Context
): Node | undefined {
  const renderKey = ctx.renderKey
    ?? node.renderKey
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
  if (ctx.renderKey !== undefined) {
    if (parent) {
      addParentEdge(node, ctx.renderKey, parent);
    } else {
      removeParentEdge(node, ctx.renderKey);
    }
    return;
  }
}

export function isEvaluated(
  node: Node,
  ctx: Context
): boolean {
  return node.evaluated;
}

export function setEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  node.evaluated = value;
}

export function isPreEvaluated(
  node: Node,
  ctx: Context
): boolean {
  return node.preEvaluated;
}

export function setPreEvaluated(
  node: Node,
  value: boolean,
  ctx: Context
): void {
  node.preEvaluated = value;
}

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

export function setIndex(
  node: Node,
  index: number,
  ctx: Context
): void {
  ctx.activeState.get(node).fields.set('index', index);
}

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

export function setSourceParent(
  node: Node,
  parent: Node | undefined,
  ctx: Context
): void {
  ctx.activeState.get(node).fields.set('sourceParent', parent);
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
  if (ctx.renderKey !== undefined && rules.renderKey !== undefined && rules.renderKey === ctx.renderKey) {
    const previous = rules.value;
    (rules as unknown as { _setValueArray(value: Node[]): void })._setValueArray([...nodes]);
    for (const child of previous) {
      if (!nodes.includes(child)) {
        removeParentEdge(child, ctx.renderKey);
      }
    }
    for (const node of nodes) {
      addParentEdge(node, ctx.renderKey, rules);
    }
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  ctx.activeState.get(rules).fields.set('value', [...nodes]);
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
  if (ctx.renderKey !== undefined) {
    if (rules.renderKey !== undefined && rules.renderKey === ctx.renderKey) {
      const currentChildren = rules.value;
      if (currentChildren[index] === node) {
        return;
      }
      const previous = currentChildren[index];
      const nextValue = [...currentChildren];
      nextValue[index] = node;
      (rules as unknown as { _setValueArray(value: Node[]): void })._setValueArray(nextValue);
      if (previous && previous !== node) {
        removeParentEdge(previous, ctx.renderKey);
      }
      addParentEdge(node, ctx.renderKey, rules);
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
      removeParentEdge(previous, ctx.renderKey);
    }
    addEdgeAt(rules, 'value', index, ctx.renderKey, node);
    addParentEdge(node, ctx.renderKey, rules);
    if (options.markDirty !== false) {
      markScopeDirty(rules, ctx);
    }
    return;
  }
  const s = ctx.activeState.get(rules);
  const currentChildren = s._fields?.get('value') as Node[] | undefined
    ?? [...rules.value];
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

export function replaceNode(
  node: Node,
  replacement: Node,
  ctx: Context
): void {
  ctx.activeState.get(node).replacement = replacement;
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
  return ctx.activeState.resolve(node)?._dependency ?? null;
}

export function setDependency(
  node: Node,
  dependency: EvalDependency,
  ctx: Context
): void {
  ctx.activeState.get(node)._dependency = dependency;
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

const changedVarsMap = new WeakMap<EvalState, Set<Node>>();

export function markChangedVar(ctx: Context, node: Node): void {
  const state = ctx.activeState;
  let set = changedVarsMap.get(state);
  if (!set) {
    set = new Set();
    changedVarsMap.set(state, set);
  }
  set.add(node);
}

export function hasChangedVars(ctx: Context): boolean {
  return (changedVarsMap.get(ctx.activeState)?.size ?? 0) > 0;
}

export function getChangedVars(ctx: Context): Set<Node> | undefined {
  return changedVarsMap.get(ctx.activeState);
}
