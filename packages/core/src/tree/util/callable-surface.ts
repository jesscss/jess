import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { F_VISIBLE, Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Rules } from '../rules.js';
import { cloneWithReusableLeaves } from './cloning.js';

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

function createShallowCallableRulesSurface(sourceRules: Rules): Rules {
  const output = createDerivedRulesSurface(sourceRules);
  output.sourceNode = sourceRules.sourceNode ?? sourceRules;
  const source = sourceRules.rules;
  for (let i = 0; i < source.length; i++) {
    // Clone-per-call: the eval surface owns its own copy of each body child, so
    // it is a real self-contained scope — params (live slots), body-level vars,
    // and detached-ruleset closures all resolve against THIS surface's frame,
    // and the shared canonical body is never mutated across calls. (Scalar
    // leaves are still shared by cloneWithReusableLeaves, so the clone is cheap.)
    const clone = cloneWithReusableLeaves(source[i]!);
    clone.parent = output;
    output.rules.push(clone);
  }
  return output;
}

export function createUnlockedCallableRulesSurface(sourceRules: Rules): Rules {
  return createShallowCallableRulesSurface(sourceRules);
}

export function createOwnedCallableRulesSurface(sourceRules: Rules): Rules {
  return createShallowCallableRulesSurface(sourceRules);
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
  output.addFlag(F_VISIBLE);
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
