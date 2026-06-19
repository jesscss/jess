import { attachMixinOutputSlot } from './mixin-output-slot.js';
import {
  F_EXTENDED,
  F_EXTEND_TARGET,
  F_IMPLICIT_AMPERSAND,
  F_VISIBLE,
  Node
} from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Rules } from '../rules.js';
import { Ruleset } from '../ruleset.js';
import { AtRule } from '../at-rule.js';
import { Any } from '../any.js';
import { createPublicNil } from '../nil.js';

function callableLocation(node: Node): Node['location'] | undefined {
  return node.location.length === 0 ? undefined : node.location;
}

function applyCallableSurfaceMetadata<T extends Node>(output: T, source: Node): T {
  output._sourceRoot ??= source.sourceRoot;
  if (!source.hasFlag(F_VISIBLE)) {
    output.removeFlag(F_VISIBLE);
  }
  if (source.hasFlag(F_IMPLICIT_AMPERSAND)) {
    output.addFlag(F_IMPLICIT_AMPERSAND);
  }
  if (source.hasFlag(F_EXTENDED)) {
    output.addFlag(F_EXTENDED);
  }
  if (source.hasFlag(F_EXTEND_TARGET)) {
    output.addFlag(F_EXTEND_TARGET);
  }
  output.generated ||= source.generated;
  output.index ??= source.index;
  return output;
}

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

function createSourceBackedCallableRulesSurface(sourceRules: Rules): Rules {
  const output = sourceRules.derive([]);
  output.options.sourceBackedCallableSurface = true;
  const source = sourceRules.rules;
  for (let i = 0; i < source.length; i++) {
    const child = createSourceBackedCallablePlacementChild(source[i]!);
    if (child !== source[i]) {
      output.adopt(child);
    }
    output.value.push(child);
  }
  output.markSourceBackedCallableSurfacePrepared();
  return output;
}

function createSourceBackedCallableRuleset(sourceRuleset: Ruleset): Ruleset {
  const body = createSourceBackedCallableRulesSurface(sourceRuleset.rules);
  const output = new Ruleset(
    {
      selector: createPublicNil(),
      rules: body
    },
    sourceRuleset.options ? { ...sourceRuleset.options } : undefined,
    callableLocation(sourceRuleset),
    sourceRuleset.sourceRoot?._treeContext
  );
  applyCallableSurfaceMetadata(output, sourceRuleset);
  output.selector = sourceRuleset.selector;
  output.rules = body;
  output.guard = sourceRuleset.guard;
  output.selectorBeforeExtend = sourceRuleset.selectorBeforeExtend;
  output.value.selector = sourceRuleset.selector;
  output.value.rules = body;
  if (sourceRuleset.guard !== undefined) {
    output.value.guard = sourceRuleset.guard;
  }
  if (sourceRuleset.selectorBeforeExtend !== undefined) {
    output.value.selectorBeforeExtend = sourceRuleset.selectorBeforeExtend;
  }
  output.registrationPrepared = true;
  return output;
}

function createSourceBackedCallableAtRule(sourceAtRule: AtRule): AtRule {
  const body = sourceAtRule.rules
    ? createSourceBackedCallableRulesSurface(sourceAtRule.rules)
    : undefined;
  const output = new AtRule(
    {
      name: new Any('', { role: 'atkeyword' }),
      ...(body && { rules: body })
    },
    sourceAtRule.options ? { ...sourceAtRule.options } : undefined,
    callableLocation(sourceAtRule),
    sourceAtRule.sourceRoot?._treeContext
  );
  applyCallableSurfaceMetadata(output, sourceAtRule);
  output.name = sourceAtRule.name;
  output.prelude = sourceAtRule.prelude;
  output.rules = body;
  output.value.name = sourceAtRule.name;
  if (sourceAtRule.prelude !== undefined) {
    output.value.prelude = sourceAtRule.prelude;
  }
  if (body !== undefined) {
    output.value.rules = body;
  }
  output.hoistToRoot = sourceAtRule.hoistToRoot;
  output.frames = sourceAtRule.frames;
  output.registrationPrepared = true;
  return output;
}

function createSourceBackedCallablePlacementChild(sourceChild: Node): Node {
  if (isNode(sourceChild, N.Rules)) {
    return createSourceBackedCallableRulesSurface(sourceChild);
  }
  if (isNode(sourceChild, N.Ruleset)) {
    return createSourceBackedCallableRuleset(sourceChild);
  }
  if (isNode(sourceChild, N.AtRule)) {
    return createSourceBackedCallableAtRule(sourceChild);
  }
  return sourceChild;
}

export function createUnlockedCallableRulesSurface(sourceRules: Rules): Rules {
  const output = sourceRules.derive([]);
  output.value.push(...sourceRules.rules);
  return output;
}

export function createOwnedCallableRulesSurface(sourceRules: Rules): Rules {
  return createSourceBackedCallableRulesSurface(sourceRules);
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
