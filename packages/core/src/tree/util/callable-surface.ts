import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { Comment } from '../comment.js';
import { F_STATIC, Node, type LocationInfo } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Rules } from '../rules.js';
import { canReuseLeaf, reuseLeaf } from './cloning.js';
import { Mixin } from '../mixin.js';
import { Ruleset } from '../ruleset.js';
import { AtRule } from '../at-rule.js';

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
  return canReuseLeaf(node) ? reuseLeaf(node) : undefined;
}

function constructCallableRulesNode(node: Node, value: unknown): Node {
  const copy = Reflect.construct(
    node.constructor,
    [
      value,
      node.options ? { ...node.options } : undefined,
      node.location.length === 0 ? undefined : node.location
    ]
  );
  if (!(copy instanceof Node)) {
    throw new TypeError('Expected callable rules copy to remain a node');
  }
  return copy.inherit(node);
}

function callableLocation(node: Node): LocationInfo | undefined {
  return node.location.length === 6 ? node.location : undefined;
}

function copyCallableDirectFieldNode(node: Node): Node | undefined {
  if (isNode(node, N.Mixin)) {
    return new Mixin(
      {
        ...(node.name !== undefined && {
          name: copyCallableRulesNode(node.name) as Mixin['name']
        }),
        rules: copyCallableRulesNode(node.rules) as Rules,
        ...(node.params !== undefined && {
          params: copyCallableRulesNode(node.params) as Mixin['params']
        }),
        ...(node.guard !== undefined && {
          guard: copyCallableRulesNode(node.guard) as Mixin['guard']
        })
      },
      node.options ? { ...node.options } : undefined,
      callableLocation(node),
      node.sourceRoot?._treeContext
    ).inherit(node);
  }
  if (isNode(node, N.Ruleset)) {
    return new Ruleset(
      {
        selector: copyCallableRulesNode(node.selector) as Ruleset['selector'],
        rules: copyCallableRulesNode(node.rules) as Rules,
        ...(node.guard !== undefined && {
          guard: copyCallableRulesNode(node.guard) as Ruleset['guard']
        }),
        ...(node.selectorBeforeExtend !== undefined && {
          selectorBeforeExtend: copyCallableRulesNode(node.selectorBeforeExtend) as Ruleset['selectorBeforeExtend']
        })
      },
      node.options ? { ...node.options } : undefined,
      callableLocation(node),
      node.sourceRoot?._treeContext
    ).inherit(node);
  }
  if (isNode(node, N.AtRule)) {
    return new AtRule(
      {
        name: copyCallableRulesNode(node.name) as AtRule['name'],
        ...(node.prelude !== undefined && {
          prelude: copyCallableRulesNode(node.prelude)
        }),
        ...(node.rules !== undefined && {
          rules: copyCallableRulesNode(node.rules) as Rules
        })
      },
      node.options ? { ...node.options } : undefined,
      callableLocation(node),
      node.sourceRoot?._treeContext
    ).inherit(node);
  }
  return undefined;
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
  const directFieldCopy = copyCallableDirectFieldNode(node);
  if (directFieldCopy) {
    return directFieldCopy;
  }
  return constructCallableRulesNode(node, copyCallableRulesValue(node.value));
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
  const source = sourceRules.rules;
  for (let i = 0; i < source.length; i++) {
    output.value.push(source[i]!);
  }
  output.markSourceBackedCallableSurfacePrepared();
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
      || child.options?.setDefined === true
      || (child.options?.assign !== undefined && child.options.assign !== ':')
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
