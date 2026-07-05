import { sourceSpanOf } from './provenance.js';
import { attachMixinOutputSlot } from './mixin-output-slot.js';
import { F_VISIBLE, Node } from '../node.js';
import { N } from '../node-type.js';
import { isNode } from './is-node.js';
import { Rules } from '../rules.js';

export function isIndexedRuleChild(node: Node): boolean {
  return !isNode(node, N.Comment);
}

export function getRootSourceRules(rules: Rules): Rules {
  let current = rules;
  const seen = new Set<Rules>();
  // A canonical body can be any Rules SUBCLASS (Mixin/Ruleset), not only a plain
  // Rules — since the Mixin.sourceNode wrapper was eliminated, a mixin surface's
  // sourceNode IS the Mixin. `instanceof Rules` walks all three; the old bitmask
  // `N.Rules` check stopped at a Mixin/Ruleset sourceNode.
  while (current.sourceNode instanceof Rules) {
    const next = current.sourceNode;
    if (next === current || seen.has(next)) {
      break;
    }
    seen.add(current);
    current = next;
  }
  return current;
}

/**
 * The single callable rules-surface primitive. (Formerly split into identical
 * `createUnlocked…`/`createOwned…` variants — the Owned/Unlocked distinction did
 * not exist in the implementation and has been collapsed.)
 */
export function createCallableRulesSurface(sourceRules: Rules): Rules {
  const output = createDerivedRulesSurface(sourceRules);
  // `sourceNode` pointing at a DIFFERENT canonical body IS the thin-surface
  // identity: a shared child evaluated under this surface re-points its
  // scope-frame lexical parent here (resolving up the call's scope — lexical
  // definition + live param slots) rather than its static canonical parent.
  // One frame model for all node re-use; no marker. See §4 / §6.2.
  output.sourceNode = sourceRules.sourceNode ?? sourceRules;
  const source = sourceRules.rules;
  for (let i = 0; i < source.length; i++) {
    // Share the canonical body children (the AST is an immutable template). The
    // per-call eval surface carries call state in its attached scope frame, not
    // in cloned nodes; the body resolves against this surface via context.
    output.rules.push(source[i]!);
  }
  return output;
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
  const sourceLocation = sourceSpanOf(sourceRules);
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
    output.sourceNode instanceof Rules
      ? output.sourceNode
      : output
  );
}
