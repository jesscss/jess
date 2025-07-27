import { describe, it, expect } from 'vitest';
import {
  SelectorRegistry,
  MixinRegistry
} from '../selector-utils';
import {
  el,
  compound,
  ruleset,
  rules,
  mixin,
  ComplexSelector,
  amp,
  SelectorList,
  sel,
  co,
  Rules
} from '../../index';
import { Context } from '../../../context';

let context: Context;

function makeAmpersand(parts: string[]) {
  return amp({ selector: makeCompound(parts) });
}

function makeCompound(parts: string[]) {
  return compound(parts.map(p => el(p)));
}

describe('SelectorRegistry', () => {
  let baseRules: Rules;
  let registry: SelectorRegistry;
  beforeEach(() => {
    context = new Context();
    baseRules = rules([]);
    registry = baseRules.selectorRegistry;
  });
  it('registers a selector by all keys', () => {
    const selector = ['.foo', '.bar'];
    const find = ['.foo', '.bar'];

    const rs = rules([]);
    const rulesetNode = ruleset({
      selector: makeCompound(selector),
      rules: rs
    });
    registry.addRuleset(rulesetNode);
    expect((registry as any).pendingRulesets.size).toBe(1);
    const candidates = registry.findCandidateRulesets(makeCompound(find));
    expect(candidates?.has(rulesetNode)).toBe(true);
  });

  it('registers a complex selector by all keys', () => {
    const ampSelector = ['.one', '.two'];
    const ruleSelector = ['.three', '.four'];
    const keys = ['.one', '.two', '.three', '.four'];
    const find = ['.one', '.four'];

    const rs = rules([]);
    const ampWithSelector = amp({ selector: makeCompound(ampSelector) });
    const rulesetNode = ruleset({
      selector: compound([ampWithSelector, ...ruleSelector.map(p => el(p))]),
      rules: rs
    });
    registry.addRuleset(rulesetNode);
    (registry as any).indexPendingRulesets();
    expect(Array.from((registry as any).index.keys())).toEqual(keys);
    const candidates = registry.findCandidateRulesets(makeCompound(find));
    expect(candidates?.has(rulesetNode)).toBe(true);
  });

  it('registers a selector with its parent', () => {
    const parentSelector = ['.one', '.two'];
    const ruleSelector = ['.three', '.four'];
    const keys = ['.one', '.two', '.three', '.four'];
    const find = ['.two', '.three'];

    const rs = rules([]);
    const rulesetNode = ruleset({
      selector: makeCompound(ruleSelector),
      rules: rs
    });
    rulesetNode.parentSelector = makeCompound(parentSelector);
    registry.addRuleset(rulesetNode);
    (registry as any).indexPendingRulesets();
    expect(Array.from((registry as any).index.keys())).toEqual(keys);
    const candidates = registry.findCandidateRulesets(makeCompound(find));
    expect(candidates?.has(rulesetNode)).toBe(true);
  });

  it('does not match rulesets with different selectors', () => {
    const rs = rules([]);
    const rulesetNode = ruleset({
      selector: makeCompound(['.foo', '.bar']),
      rules: rs
    });
    registry.addRuleset(rulesetNode as any);
    const candidates = registry.findCandidateRulesets(makeCompound(['.foo', '.baz']));
    expect(candidates?.size).toBeFalsy();
  });
});

describe('MixinRegistry', () => {
  let baseRules: Rules;
  let registry: MixinRegistry;
  beforeEach(() => {
    context = new Context();
    baseRules = rules([]);
    registry = baseRules.mixinRegistry;
  });

  it('indexes and matches mixins', () => {
    const selector = ['.foo', '.bar'];
    const find = ['.foo', '.bar'];

    const mixinNode = mixin({
      selector: makeCompound(selector),
      rules: rules([]),
      params: undefined
    });
    registry.addMixin(mixinNode);
    let candidates = registry.findCandidateMixins(makeCompound(find));
    expect(candidates?.has(mixinNode)).toBe(true);
    candidates = registry.findCandidateMixins(makeCompound(find));
    expect(candidates?.has(mixinNode)).toBe(true);
    candidates = registry.findCandidateMixins(makeCompound(find), 'Mixin');
    expect(candidates?.has(mixinNode)).toBe(true);
    candidates = registry.findCandidateMixins(makeCompound(find), 'Ruleset');
    expect(candidates?.has(mixinNode)).toBeFalsy();
  });

  it('indexes and matches rulesets', () => {
    const selector = ['.foo', '.bar'];
    const find = ['.foo', '.bar'];

    const rs = rules([]);
    const rulesetNode = ruleset({ selector: makeCompound(selector), rules: rs });
    registry.addMixin(rulesetNode);
    let candidates = registry.findCandidateMixins(makeCompound(find), 'Ruleset');
    expect(candidates?.has(rulesetNode)).toBe(true);
    candidates = registry.findCandidateMixins(makeCompound(find));
    expect(candidates?.has(rulesetNode)).toBe(true);
    candidates = registry.findCandidateMixins(makeCompound(find), 'Mixin');
    expect(candidates?.has(rulesetNode)).toBeFalsy();
  });

  it('does not match mixins with different selectors', () => {
    const rs = rules([]);
    const mixinNode = mixin({ selector: makeCompound(['.foo', '.bar']), rules: rs, params: undefined });
    registry.addMixin(mixinNode);
    const candidates = registry.findCandidateMixins(makeCompound(['.foo', '.baz']));
    expect(candidates?.size).toBeFalsy();
  });

  it('ignores space and > combinators', () => {
    const mixinNode = ruleset({
      selector: sel([el('.foo'), co(' '), el('.bar')]),
      rules: rules([])
    });
    registry.addMixin(mixinNode);
    let candidates = registry.findCandidateMixins(makeCompound(['.foo', '.bar']));
    expect(candidates?.has(mixinNode)).toBe(true);
    candidates = registry.findCandidateMixins(sel([el('.foo'), co(' '), el('.bar')]));
    expect(candidates?.has(mixinNode)).toBe(true);
    candidates = registry.findCandidateMixins(sel([el('.foo'), co('>'), el('.bar')]));
    expect(candidates?.has(mixinNode)).toBe(true);
  });

  it('indexes and matches rulesets with ampersand', () => {
    const mixinNode = ruleset({
      selector: compound([amp(), el('.foo')]),
      rules: rules([])
    });
    registry.addMixin(mixinNode);
    const candidates = registry.findCandidateMixins(['.foo']);
    expect(candidates?.has(mixinNode)).toBe(true);
  });

  it('recursively matches mixins in child rulesets when search is longer', () => {
    const childRs = rules([]) as Rules;
    const childMixinNode = mixin({
      selector: makeCompound(['.bar']),
      rules: childRs,
      params: undefined
    });
    childRs.mixinRegistry.addMixin(childMixinNode);
    const parentMixinNode = mixin({
      selector: makeCompound(['.foo']),
      rules: childRs,
      params: undefined
    });
    registry.addMixin(parentMixinNode);
    const candidates = registry.findCandidateMixins(['.foo', '.bar']);
    expect(candidates?.has(childMixinNode)).toBe(true);
  });

  it('can combine multiple search types', () => {
    const childRs = rules([]) as Rules;
    const childMixinNode = mixin({
      selector: makeCompound(['.bar']),
      rules: childRs,
      params: undefined
    });
    childRs.mixinRegistry.addMixin(childMixinNode);
    const parentMixinNode = mixin({
      selector: makeCompound(['.foo']),
      rules: childRs,
      params: undefined
    });
    registry.addMixin(parentMixinNode);
    const anotherRulesetNode = ruleset({
      selector: makeCompound(['.foo', '.bar']),
      rules: rules([])
    });
    registry.addMixin(anotherRulesetNode);

    const candidates = registry.findCandidateMixins(['.foo', '.bar']);
    expect(candidates?.size).toBe(2);
    expect(candidates?.has(childMixinNode)).toBe(true);
    expect(candidates?.has(anotherRulesetNode)).toBe(true);
  });

  it('can search parents', () => {
    /**
     * .base {
     *   .grandparent {
     *     .parent {
     *       .child {}
     *       .sibling {}
     *     }
     *   }
     * }
     */
    const childMixinNode = mixin({
      selector: el('.child'),
      rules: rules([])
    });
    const siblingMixinNode = mixin({
      selector: el('.sibling'),
      rules: rules([])
    });
    const parentMixinNode = mixin({
      selector: el('.parent'),
      rules: rules([
        childMixinNode,
        siblingMixinNode
      ]),
      params: undefined
    });
    const grandparentMixinNode = mixin({
      selector: el('.grandparent'),
      rules: rules([
        parentMixinNode
      ]),
      params: undefined
    });
    registry.addMixin(grandparentMixinNode);
    /** This should happen during eval()) */
    grandparentMixinNode.value.rules.mixinRegistry.addMixin(parentMixinNode);
    parentMixinNode.value.rules.mixinRegistry.addMixin(childMixinNode);
    parentMixinNode.value.rules.mixinRegistry.addMixin(siblingMixinNode);
    /** From the child, we should be able to find the local .sibling */
    let candidates = childMixinNode.value.rules.mixinRegistry.findCandidateMixins(['.sibling']);
    expect(candidates?.has(siblingMixinNode)).toBe(true);
    /** From the child, we should be able to find the parent .parent */
    candidates = childMixinNode.value.rules.mixinRegistry.findCandidateMixins(['.parent']);
    expect(candidates?.has(parentMixinNode)).toBe(true);
    /** But we should also find .parent .sibling from the child because of going to the parent then back */
    candidates = childMixinNode.value.rules.mixinRegistry.findCandidateMixins(['.parent', '.sibling']);
    expect(candidates?.has(siblingMixinNode)).toBe(true);
  });

  /**
   * Unlike mixins, rulesets are evaluated immediately,
   * so we should see their "mixin" registries populated.
   */
  it.only('can search rulesets after eval()', async () => {
    const childRulesetNode = ruleset({
      selector: el('.child'),
      rules: rules([])
    });
    const siblingRulesetNode = ruleset({
      selector: el('.sibling'),
      rules: rules([])
    });
    const parentRulesetNode = ruleset({
      selector: el('.parent'),
      rules: rules([
        childRulesetNode,
        siblingRulesetNode
      ])
    });
    const grandparentRulesetNode = ruleset({
      selector: el('.grandparent'),
      rules: rules([
        parentRulesetNode
      ])
    });
    baseRules.push(grandparentRulesetNode);
    await baseRules.eval(context);
    let candidates = childRulesetNode.value.rules.mixinRegistry.findCandidateMixins(['.sibling']);
    expect(candidates?.has(siblingRulesetNode)).toBe(true);
    /** From the child, we should be able to find the parent .parent */
    candidates = childRulesetNode.value.rules.mixinRegistry.findCandidateMixins(['.parent']);
    expect(candidates?.has(parentRulesetNode)).toBe(true);
    /** But we should also find .parent .sibling from the child because of going to the parent then back */
    candidates = childRulesetNode.value.rules.mixinRegistry.findCandidateMixins(['.parent', '.sibling']);
    expect(candidates?.has(siblingRulesetNode)).toBe(true);
  });
});