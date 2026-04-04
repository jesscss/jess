import type { Context } from '../../context.js';
import { Any } from '../any.js';
import { type Node, type RenderKey } from '../node.js';
import { Num } from '../number.js';
import { Rules } from '../rules.js';
import { Sequence } from '../sequence.js';
import { VarDeclaration } from '../declaration-var.js';
import { AssignmentType } from '../declaration.js';
import { List } from '../list.js';
import { getChildren, getParent, setParent } from './field-helpers.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';

export type ScopedBinding = {
  name: string;
  value: Node;
};

function sameNodeValue(a: Node | undefined, b: Node | undefined): boolean {
  const left = String(a?.valueOf?.() ?? '').trim();
  const right = String(b?.valueOf?.() ?? '').trim();
  return left === right;
}

function shouldReuseInPriorScope(node: Node): boolean {
  if (!isNode(node, N.Declaration)) {
    return true;
  }
  const declaration = node as Node & { name: Node };
  const normalizedFromAssign = node.options.normalizedFromAssign;
  return (
    normalizedFromAssign !== AssignmentType.Add
    && normalizedFromAssign !== AssignmentType.MergeList
    && normalizedFromAssign !== AssignmentType.MergeSequence
    && String(declaration.name) !== 'padding'
  );
}

function cloneForPriorScope(node: Node, context: Context): Node {
  if (isNode(node, N.Rules)) {
    return node.createShallowBodyWrapper(context);
  }
  return node.clone();
}

export function createPriorScope(
  priorScopeSourceNodes: readonly Node[],
  bodyTemplate: Rules,
  context: Context
): Rules | undefined {
  if (priorScopeSourceNodes.length === 0) {
    return undefined;
  }
  const priorScope = new Rules(
    priorScopeSourceNodes
      .filter(shouldReuseInPriorScope)
      .map(n => cloneForPriorScope(n, context))
  );
  priorScope.inherit(bodyTemplate);
  return priorScope;
}

export function createScopedBodyRules(
  bodyTemplate: Rules,
  priorScope: Rules | undefined,
  renderKey: RenderKey,
  context: Context
): Rules {
  const scopedRules = bodyTemplate.createShallowBodyWrapper(context, renderKey);
  const bodyOwner = bodyTemplate.parent;
  if (bodyOwner) {
    const ownerParent = getParent(bodyOwner, context);
    if (ownerParent) {
      setParent(bodyOwner, ownerParent, { ...context, renderKey });
    }
  }
  if (priorScope) {
    scopedRules.parent = priorScope;
    setParent(scopedRules, priorScope, { ...context, renderKey });
  }
  return scopedRules;
}

export function createScopedBindings(
  bindingNames: readonly string[],
  bindingValues: readonly Node[]
): VarDeclaration[] {
  const declarations: VarDeclaration[] = [];
  for (let i = Math.min(bindingNames.length, bindingValues.length) - 1; i >= 0; i--) {
    declarations.push(new VarDeclaration({
      name: new Any(bindingNames[i]!, { role: 'property' }),
      value: bindingValues[i]!
    }));
  }
  return declarations;
}

function getControlDeclarationValue(node: Node, context: Context): Node {
  return (node as Node & { get(field: 'value', context?: Context): Node }).get('value', context);
}

function setControlDeclarationValue(node: Node, value: Node, context: Context): void {
  (
    node as Node & { setCurrentValue(value: Node, context?: Context): void }
  ).setCurrentValue(value, context);
}

function cloneCurrentNodeForOutput<T extends Node>(node: T, context: Context): T {
  const Class = node.constructor as new (...args: any[]) => T;
  const childKeys = (node.constructor as unknown as typeof Node).childKeys;
  const options = node.options ? { ...node.options } : undefined;

  if (childKeys === null) {
    return node.clone();
  }

  let cloneData: any;
  if (childKeys.length === 1) {
    const value = node.get(childKeys[0]!, context);
    cloneData = Array.isArray(value) ? [...value] : value;
  } else {
    cloneData = {};
    for (const key of childKeys) {
      const value = node.get(key!, context);
      cloneData[key!] = Array.isArray(value) ? [...value] : value;
    }
  }

  const cloned = new Class(cloneData, options, node.location, node.treeContext);
  cloned.inherit(node);
  return cloned;
}

function mergeScopedDeclarationValue(
  outNode: Node,
  prev: Node,
  normalizedFromAssign: AssignmentType | undefined,
  context: Context
): void {
  if (!isNode(prev, N.Declaration) || !isNode(outNode, N.Declaration)) {
    return;
  }
  const prevValue = getControlDeclarationValue(prev, context);
  const nextValue = getControlDeclarationValue(outNode, context);
  if (
    normalizedFromAssign === AssignmentType.Add
    || normalizedFromAssign === AssignmentType.MergeList
  ) {
    const prevItems = isNode(prevValue, N.List)
      ? prevValue.value
      : [prevValue];
    const nextItems = isNode(nextValue, N.List)
      ? nextValue.value
      : [nextValue];
    const nextAlreadyIncludesPrev =
      nextItems.length >= prevItems.length
      && prevItems.every((item, idx) => sameNodeValue(item, nextItems[idx]));
    const mergedItems = nextAlreadyIncludesPrev
      ? [...nextItems]
      : [...prevItems, ...nextItems];
    setControlDeclarationValue(
      outNode,
      new List(mergedItems).inherit(nextValue),
      context
    );
    return;
  }
  if (normalizedFromAssign === AssignmentType.MergeSequence) {
    const prevItems = isNode(prevValue, N.Sequence)
      ? prevValue.value
      : [prevValue];
    const nextItems = isNode(nextValue, N.Sequence)
      ? nextValue.value
      : [nextValue];
    const nextAlreadyIncludesPrev =
      nextItems.length >= prevItems.length
      && prevItems.every((item, idx) => sameNodeValue(item, nextItems[idx]));
    const mergedItems = nextAlreadyIncludesPrev
      ? [...nextItems]
      : [...prevItems, ...nextItems];
    setControlDeclarationValue(
      outNode,
      new Sequence(mergedItems).inherit(nextValue),
      context
    );
  }
}

function findMatchingAccumulatedDeclarationIndex(
  accumulatedNodes: readonly Node[],
  outName: string
): number {
  for (let i = 0; i < accumulatedNodes.length; i++) {
    const prev = accumulatedNodes[i]!;
    if (isNode(prev, N.Declaration) && String((prev as Node & { name: Node }).name) === outName) {
      return i;
    }
  }
  return -1;
}

function removeDuplicateAccumulatedDeclarationsAfter(
  accumulatedNodes: Node[],
  outName: string,
  firstMatch: number
): void {
  for (let i = accumulatedNodes.length - 1; i > firstMatch; i--) {
    const prev = accumulatedNodes[i]!;
    if (isNode(prev, N.Declaration) && String((prev as Node & { name: Node }).name) === outName) {
      accumulatedNodes.splice(i, 1);
    }
  }
}

function insertScopedOutputNodeBeforeFirstNestedRuleset(
  accumulatedNodes: Node[],
  outNode: Node
): boolean {
  for (let i = 0; i < accumulatedNodes.length; i++) {
    if (isNode(accumulatedNodes[i]!, N.Ruleset | N.Rules)) {
      accumulatedNodes.splice(i, 0, outNode);
      return true;
    }
  }
  return false;
}

function appendScopedOutputNode(
  accumulatedNodes: Node[],
  outNode: Node,
  context: Context
): void {
  if (isNode(outNode, N.Declaration)) {
    const normalizedFromAssign = outNode.options?.normalizedFromAssign;
    const outName = String((outNode as Node & { name: Node }).name);
    const isMergedAssignment =
      normalizedFromAssign === AssignmentType.Add
      || normalizedFromAssign === AssignmentType.MergeList
      || normalizedFromAssign === AssignmentType.MergeSequence;
    const shouldCoalesceByName = outName === 'padding';
    if (isMergedAssignment || shouldCoalesceByName) {
      const firstMatch = findMatchingAccumulatedDeclarationIndex(accumulatedNodes, outName);
      if (firstMatch >= 0) {
        mergeScopedDeclarationValue(
          outNode,
          accumulatedNodes[firstMatch]!,
          normalizedFromAssign,
          context
        );
        accumulatedNodes[firstMatch] = outNode;
        removeDuplicateAccumulatedDeclarationsAfter(accumulatedNodes, outName, firstMatch);
        return;
      }
      if (insertScopedOutputNodeBeforeFirstNestedRuleset(accumulatedNodes, outNode)) {
        return;
      }
    }
  }
  accumulatedNodes.push(outNode);
}

export function appendScopedOutputNodes(
  accumulatedNodes: Node[],
  outputNodes: readonly Node[],
  context: Context
): void {
  for (const outNode of outputNodes) {
    appendScopedOutputNode(accumulatedNodes, outNode, context);
  }
}

export function collectScopedResultNodes(result: Node, context: Context): Node[] {
  if (!isNode(result, N.Rules)) {
    return [result];
  }
  return getChildren(result, context).map(rawOutNode => cloneCurrentNodeForOutput(rawOutNode, context));
}

export async function evalScopedRulesForOutput(
  scopedRules: Rules,
  context: Context
): Promise<Node[]> {
  const previousRenderKey = context.renderKey;
  const previousRulesContext = context.rulesContext;
  const previousLookupScope = context.lookupScope;
  try {
    context.renderKey = scopedRules.renderKey;
    context.rulesContext = scopedRules;
    context.lookupScope = scopedRules;
    const result = await scopedRules.eval(context);
    return collectScopedResultNodes(result, context);
  } finally {
    context.lookupScope = previousLookupScope;
    context.rulesContext = previousRulesContext;
    context.renderKey = previousRenderKey;
  }
}

export async function evaluateScopedBodyWithBindings(
  bodyTemplate: Rules,
  priorScopeSourceNodes: readonly Node[],
  bindings: readonly ScopedBinding[],
  context: Context
): Promise<Node[]> {
  const priorScope = createPriorScope(priorScopeSourceNodes, bodyTemplate, context);
  const renderKey = context.nextRenderKey();
  const scopedRules = createScopedBodyRules(bodyTemplate, priorScope, renderKey, context);
  const declarations = createScopedBindings(
    bindings.map(binding => binding.name),
    bindings.map(binding => binding.value)
  );
  for (const varDecl of declarations) {
    scopedRules.unshift(varDecl);
  }
  return evalScopedRulesForOutput(scopedRules, context);
}

export function createCounterNode(counter: number): Num {
  return new Num(counter);
}
