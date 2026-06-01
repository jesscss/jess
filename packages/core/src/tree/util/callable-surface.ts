import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './cloning.js';
import { attachMixinOutputSlot, getMixinOutputChildSegments } from './mixin-output-slot.js';
import { Comment } from '../comment.js';
import { Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Rules } from '../rules.js';

export function isIndexedRuleChild(node: Node): boolean {
  return !isNode(node, N.Comment);
}

export function copyGuardForEval(guard: Node): Node {
  const copied = copyWithReusableLeaves(guard);
  if (copied.type !== guard.type) {
    throw new TypeError(`Copied guard must remain ${guard.type}, got ${copied.type}`);
  }
  return copied;
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

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function copyCallableRulesValue(value: unknown): unknown {
  if (value instanceof Node) {
    return copyCallableRulesNode(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => copyCallableRulesValue(item));
  }
  if (isRecordValue(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(value, key)) {
        out[key] = copyCallableRulesValue(item);
      }
    }
    return out;
  }
  return value;
}

function copyCallableAmpersand(node: Node): Node | undefined {
  if (node.type !== 'Ampersand') {
    return undefined;
  }
  const makeCopy: unknown = Reflect.get(node, 'derive');
  if (typeof makeCopy !== 'function') {
    return undefined;
  }
  const copied = makeCopy.call(node);
  return copied instanceof Node ? copied : undefined;
}

function copyCallableCommentNode(node: Comment): Node {
  return new Comment(
    node.value,
    node.options ? { ...node.options } : undefined,
    node.location.length === 0 ? undefined : node.location,
    node.treeContext
  ).inherit(node);
}

function copyCallableReusableLeaf(node: Node): Node | undefined {
  return canReuseLeaf(node) ? reuseLeaf(node) : undefined;
}

function constructCallableRulesNode(node: Node, value: unknown): Node {
  const copy = Reflect.construct(
    node.constructor,
    [
      value,
      node.options ? { ...node.options } : undefined,
      node.location.length === 0 ? undefined : node.location,
      node.treeContext
    ]
  );
  if (!(copy instanceof Node)) {
    throw new TypeError('Expected callable rules copy to remain a node');
  }
  return copy.inherit(node);
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
  return constructCallableRulesNode(node, copyCallableRulesValue(node.value));
}

function copyCallableRulesSegment(segment: { source: Node }): Node {
  return copyCallableRulesNode(segment.source);
}

export function createUnlockedCallableRulesSurface(sourceRules: Rules): Rules {
  return sourceRules.derive();
}

export function createOwnedCallableRulesSurface(sourceRules: Rules): Rules {
  return sourceRules.derive(
    getMixinOutputChildSegments(sourceRules).map(copyCallableRulesSegment)
  );
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
    sourceRules.treeContext
  ).inherit(sourceRules);
  if (sourceRules.functionRegistry) {
    output.functionRegistry = sourceRules.functionRegistry.cloneForRules(output);
  }
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
