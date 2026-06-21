import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { Comment } from '../comment.js';
import { F_STATIC, Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Rules } from '../rules.js';

export function isIndexedRuleChild(node: Node): boolean {
  return !isNode(node, N.Comment);
}

export function getRootSourceRules(rules: Rules): Rules {
  let current = rules;
  const seen = new Set<Rules>();
  while (current.sourceNode && isNode(current.sourceNode, N.Rules)) {
    const next = current.sourceNode;
    if (next === current || seen.has(next)) {
      break;
    }
    seen.add(current);
    current = next;
  }
  return current;
}

function copyCallableAmpersand(node: Node): Node | undefined {
  if (!isNode(node, N.Ampersand)) {
    return undefined;
  }
  const copied = node.derive();
  return copied instanceof Node ? copied : undefined;
}

function copyCallableCommentNode(node: Comment): Node {
  return new Comment(
    node.value,
    node.options ? { ...node.options } : undefined,
    node.location.length === 0 ? undefined : node.location,
    node.sourceRoot?._treeContext
  ).inherit(node);
}

function copyCallableReusableLeaf(node: Node): Node | undefined {
  return node.canReuseAsLeaf() ? node.reuseAsLeaf() : undefined;
}

function copyCallableRulesNode(node: Node): Node {
  if (isNode(node, N.Comment)) {
    return copyCallableCommentNode(node);
  }
  const copiedAmpersand = copyCallableAmpersand(node);
  if (copiedAmpersand) {
    return copiedAmpersand;
  }
  const reusableLeaf = copyCallableReusableLeaf(node);
  if (reusableLeaf) {
    return reusableLeaf;
  }
  return node.clone(true, copyCallableRulesNode);
}

function copyCallableRulesChildren(sourceRules: Rules): Node[] {
  const source = sourceRules.rules;
  const out = new Array<Node>(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = copyCallableRulesNode(source[i]!);
  }
  return out;
}

function createStaticCallableRulesSurface(sourceRules: Rules): Rules {
  const output = sourceRules.derive([]);
  output.sourceNode = sourceRules.sourceNode ?? sourceRules;
  const source = sourceRules.rules;
  for (let i = 0; i < source.length; i++) {
    output.value.push(source[i]!);
  }
  return output;
}

function canReuseStaticCallableChildren(sourceRules: Rules): boolean {
  if (!sourceRules.hasFlag(F_STATIC)) {
    return false;
  }
  const value = sourceRules.rules;
  for (let i = 0; i < value.length; i++) {
    const child = value[i]!;
    if (
      child.type === 'Ruleset'
      || child.type === 'AtRule'
      || child.options?.assign !== undefined
    ) {
      return false;
    }
  }
  return true;
}

export function createUnlockedCallableRulesSurface(sourceRules: Rules): Rules {
  return sourceRules.derive();
}

export function createOwnedCallableRulesSurface(sourceRules: Rules): Rules {
  return canReuseStaticCallableChildren(sourceRules)
    ? createStaticCallableRulesSurface(sourceRules)
    : sourceRules.derive(copyCallableRulesChildren(sourceRules));
}

type DerivedRulesSurfaceOptions = {
  rulesOptions?: Rules['options'];
  markMixinOutput?: boolean;
  restrictMixinOutputLookup?: boolean;
};

function createDerivedRulesSurface(
  sourceRules: Rules,
  options?: DerivedRulesSurfaceOptions
): Rules {
  const sourceOptions = sourceRules.options;
  const sourceLocation = sourceRules.location.length === 0
    ? undefined
    : sourceRules.location;
  const output = new Rules(
    [],
    {
      ...sourceOptions,
      rulesVisibility: { ...sourceOptions.rulesVisibility }
    },
    sourceLocation,
    sourceRules._treeContext
  ).inherit(sourceRules);
  output.scopeFrame = undefined;
  if (options?.rulesOptions || options?.markMixinOutput) {
    output.options = {
      ...output.options,
      ...options?.rulesOptions
    };
  }
  if (options?.markMixinOutput) {
    output.options = {
      ...output.options,
      rulesVisibility: {
        Ruleset: 'public',
        Declaration: 'public',
        VarDeclaration: 'public',
        Mixin: 'public'
      }
    };
    attachMixinOutputSlot(output, sourceRules, options.restrictMixinOutputLookup === true);
  }
  return output;
}

export function createCallableOuterRules(sourceRules: Rules, options?: Rules['options']): Rules {
  return createDerivedRulesSurface(sourceRules, { rulesOptions: options });
}

export function createMixinOutputRulesWrapper(sourceRules: Rules, restrictMixinOutputLookup: boolean): Rules {
  return createDerivedRulesSurface(sourceRules, {
    markMixinOutput: true,
    restrictMixinOutputLookup
  });
}

export function createEmptyCallableOutputSurface(sourceRules: Rules): Rules {
  return createDerivedRulesSurface(sourceRules);
}

export function resolveCallableSingleOutputSourceRules(output: Rules): Rules {
  return getRootSourceRules(
    output.sourceNode && isNode(output.sourceNode, N.Rules)
      ? output.sourceNode
      : output
  );
}
