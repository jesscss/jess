/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import type { Selector } from '../selector.js';
import type { Rules } from '../rules.js';
import { isNode } from './is-node.js';
import { N } from '../node-type.js';
import { Nil } from '../nil.js';
import { Node } from '../node.js';
import type { Context } from '../../context.js';
import {
  canEnterRulesEntryForLookup,
  getMixinOutputLookupState,
  type LookupVisibility,
  type MixinOutputLookupState,
  type RulesEntryLike
} from './mixin-output-slot.js';

const { isArray } = Array;

export type RulesEntryTraversalState = {
  canEnter: boolean;
  mixinOutput?: MixinOutputLookupState;
};

export function getRulesEntryTraversalState(
  entry: RulesEntryLike,
  lookup: {
    type?: LookupVisibility;
    hasTarget?: boolean;
  }
): RulesEntryTraversalState {
  const mixinOutput = getMixinOutputLookupState(entry, lookup);
  return {
    canEnter: mixinOutput?.canEnter ?? canEnterRulesEntryForLookup(entry, lookup),
    ...(mixinOutput ? { mixinOutput } : {})
  };
}

export function getOrderedSelectorKeys(selector: Selector | Nil | undefined): string[] {
  if (!selector || isNode(selector, N.Nil)) {
    return [];
  }
  const keys: string[] = [];
  let foundBasic = false;
  const visit = (node: Selector | Nil | undefined) => {
    if (!node || isNode(node, N.Nil)) {
      return;
    }
    if (!foundBasic && isNode(node, N.Ampersand)) {
      return;
    }
    if (isNode(node, N.Combinator)) {
      return;
    }
    if (isNode(node, N.BasicSelector)) {
      const value = String(node.valueOf?.() ?? node.value ?? '');
      if (!value || value.startsWith('*') || value.startsWith(':')) {
        return;
      }
      keys.push(value);
      foundBasic = true;
      return;
    }
    const { value } = node as unknown as { value?: unknown };
    if (isArray(value)) {
      for (const child of value) {
        visit(child as Selector | Nil | undefined);
      }
    }
  };
  visit(selector);
  return keys;
}

export function isNonClassicImportBoundary(rules: Rules | undefined): boolean {
  return rules?.options.importBoundary === true;
}

export type DeclarationFindOptions = {
  filter?: (n: Node) => boolean;
  semanticFilter?: boolean;
  candidates?: Set<Node>;
  optionalCandidates?: Set<Node>;
  /** This gets set if any parent is set to readonly */
  readonly?: boolean;
  searchParents?: boolean;
  start?: number;
  ignoreCurrentScopeStart?: boolean;
  ignoreParentScopeStart?: boolean;
  local?: boolean;
  /** Whether this lookup has an explicit target, e.g. #ns[@foo]. */
  hasTarget?: boolean;
  /** Snapshot reads use source-position declarations without current live slots. */
  includeLiveBindings?: boolean;
};

export type CallableFindOptions = {
  searchParents?: boolean;
  local?: boolean;
  /** Whether this lookup has an explicit target, e.g. #ns[.mixin]. */
  hasTarget?: boolean;
  findAll?: boolean;
  childFilterType?: 'Mixin' | 'Ruleset' | undefined;
  context?: Context;
  /** For mixin-ruleset calls with args, namespace containers may be rulesets but terminal hits must be mixins. */
  terminalMixinOnly?: boolean;
};
