import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { Comment } from '../comment.js';
import { F_STATIC, Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Rules } from '../rules.js';
import { canReuseLeaf, reuseLeaf } from './cloning.js';

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

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function copyCallableRulesValue(value: unknown): unknown {
  if (value instanceof Node) {
    return copyCallableRulesNode(value);
  }
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = copyCallableRulesValue(value[i]);
    }
    return out;
  }
  if (isRecordValue(value)) {
    const out: Record<string, unknown> = {};
    for (const key in value) {
      out[key] = copyCallableRulesValue(value[key]);
    }
    return out;
  }
  return value;
}

function constructCallableRulesNode(node: Node, value: unknown): Node {
  const location = node._location;
  const options = node._options;
  const copy = Reflect.construct(
    node.constructor,
    [
      value,
      options ? { ...options } : undefined,
      location && location.length !== 0 ? location : undefined
    ]
  );
  if (!(copy instanceof Node)) {
    throw new TypeError('Expected callable rules copy to remain a node');
  }
  return copy.inherit(node);
}

function copyCallableRulesNode(node: Node): Node {
  if (isNode(node, N.Comment)) {
    const location = node._location;
    const options = node._options;
    return new Comment(
      node.value,
      options ? { ...options } : undefined,
      location && location.length !== 0 ? location : undefined
    ).inherit(node);
  }
  if (isNode(node, N.Ampersand)) {
    const derived = node.derive();
    if (derived instanceof Node) {
      return derived;
    }
  }
  if (canReuseLeaf(node)) {
    return reuseLeaf(node);
  }
  return constructCallableRulesNode(node, copyCallableRulesValue(node.value));
}

function copyCallableRulesChildren(sourceRules: Rules): Node[] {
  const source = sourceRules.value;
  const out = new Array<Node>(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = copyCallableRulesNode(source[i]!);
  }
  return out;
}

function createStaticCallableRulesSurface(sourceRules: Rules): Rules {
  const output = sourceRules.derive([]);
  const source = sourceRules.value;
  const value = new Array<Node>(source.length);
  for (let i = 0; i < source.length; i++) {
    value[i] = source[i]!;
  }
  // Assign after construction so source children keep canonical parentage.
  output.value = value;
  return output;
}

function canReuseStaticCallableChildren(sourceRules: Rules): boolean {
  if (!sourceRules.hasFlag(F_STATIC)) {
    return false;
  }
  const value = sourceRules.value;
  for (let i = 0; i < value.length; i++) {
    const child = value[i]!;
    if (
      isNode(child, N.Ruleset | N.AtRule)
      || child._options?.assign !== undefined
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
