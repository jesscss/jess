import { describe, it, expect, beforeEach } from 'vitest';
import { Context } from '../../../context';
import { Rules } from '../../rules';
import { Ruleset } from '../../ruleset';
import { el } from '../../selector-simple';
import { compound } from '../../selector-compound';
import { processExtends } from '../extend-roots';
import { Extend } from '../../extend';

describe('processExtends function', () => {
  let context: Context;
  let rootRules: Rules;

  beforeEach(() => {
    context = new Context();
    rootRules = new Rules();
    context.root = rootRules;
    context.extendRoots.root = rootRules;
    context.extendRoots.registerRoot(rootRules);
  });

  describe('Basic extend processing', () => {
    it('should extend a simple ruleset', () => {
      // Create .foo ruleset
      const fooRuleset = new Ruleset();
      fooRuleset.value.selector = el('.foo');
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar:extend(.foo) ruleset
      const barRuleset = new Ruleset();
      barRuleset.value.selector = el('.bar');
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      // Register extend: .bar extends .foo
      const extendNode = new Extend();
      extendNode.value.target = el('.foo');
      extendNode.value.partial = false;
      context.extends.push([
        el('.foo'),      // target
        el('.bar'),      // selectorWithExtend
        false,           // partial
        rootRules,       // extendRoot
        extendNode       // extendNode
      ]);

      // Process extends
      processExtends(context);

      // .foo should now be .foo, .bar
      expect(fooRuleset.value.selector.valueOf()).toBe('.foo,.bar');
    });

    it('should handle multiple extends on same target', () => {
      // Create .foo ruleset
      const fooRuleset = new Ruleset();
      fooRuleset.value.selector = el('.foo');
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar and .baz rulesets
      const barRuleset = new Ruleset();
      barRuleset.value.selector = el('.bar');
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      const bazRuleset = new Ruleset();
      bazRuleset.value.selector = el('.baz');
      rootRules.value.push(bazRuleset);
      rootRules.register('ruleset', bazRuleset);

      // Register extends: .bar extends .foo, .baz extends .foo
      const extend1 = new Extend();
      extend1.value.target = el('.foo');
      extend1.value.partial = false;
      context.extends.push([
        el('.foo'),
        el('.bar'),
        false,
        rootRules,
        extend1
      ]);

      const extend2 = new Extend();
      extend2.value.target = el('.foo');
      extend2.value.partial = false;
      context.extends.push([
        el('.foo'),
        el('.baz'),
        false,
        rootRules,
        extend2
      ]);

      processExtends(context);

      // .foo should now be .foo, .bar, .baz
      expect(fooRuleset.value.selector.valueOf()).toBe('.foo,.bar,.baz');
    });

    it('should skip self-referencing extends', () => {
      // Create .foo ruleset
      const fooRuleset = new Ruleset();
      fooRuleset.value.selector = el('.foo');
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Register extend: .foo extends .foo (self-reference)
      const extendNode = new Extend();
      extendNode.value.target = el('.foo');
      extendNode.value.partial = false;
      context.extends.push([
        el('.foo'),
        el('.foo'),  // same selector
        false,
        rootRules,
        extendNode
      ]);

      processExtends(context);

      // .foo should remain unchanged
      expect(fooRuleset.value.selector.valueOf()).toBe('.foo');
    });
  });

  describe('Extend chaining', () => {
    it('should chain extends when extended selector matches another target', () => {
      // Create .foo ruleset
      const fooRuleset = new Ruleset();
      fooRuleset.value.selector = el('.foo');
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar ruleset
      const barRuleset = new Ruleset();
      barRuleset.value.selector = el('.bar');
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      // Create .baz ruleset
      const bazRuleset = new Ruleset();
      bazRuleset.value.selector = el('.baz');
      rootRules.value.push(bazRuleset);
      rootRules.register('ruleset', bazRuleset);

      // Register extends:
      // 1. .bar extends .foo
      // 2. .baz extends .bar
      const extend1 = new Extend();
      extend1.value.target = el('.foo');
      extend1.value.partial = false;
      context.extends.push([
        el('.foo'),
        el('.bar'),
        false,
        rootRules,
        extend1
      ]);

      const extend2 = new Extend();
      extend2.value.target = el('.bar');
      extend2.value.partial = false;
      context.extends.push([
        el('.bar'),
        el('.baz'),
        false,
        rootRules,
        extend2
      ]);

      processExtends(context);

      // After .bar extends .foo, .bar becomes .bar, .foo
      // Then .baz extends .bar (which is now .bar, .foo)
      // So .bar should be .bar, .foo, .baz
      expect(barRuleset.value.selector.valueOf()).toBe('.bar,.foo,.baz');
    });
  });

  describe('Partial extends', () => {
    it('should handle partial extends with all flag', () => {
      // Create .a .b ruleset
      const abRuleset = new Ruleset();
      abRuleset.value.selector = compound([el('.a'), el('.b')]);
      rootRules.value.push(abRuleset);
      rootRules.register('ruleset', abRuleset);

      // Create .c ruleset
      const cRuleset = new Ruleset();
      cRuleset.value.selector = el('.c');
      rootRules.value.push(cRuleset);
      rootRules.register('ruleset', cRuleset);

      // Register extend: .c extends .b (partial)
      const extendNode = new Extend();
      extendNode.value.target = el('.b');
      extendNode.value.partial = true;
      context.extends.push([
        el('.b'),
        el('.c'),
        true,  // partial
        rootRules,
        extendNode
      ]);

      processExtends(context);

      // .a .b should become .a :is(.b, .c)
      expect(abRuleset.value.selector.valueOf()).toBe('.a:is(.b,.c)');
    });
  });

  describe('shouldSkipRuleset logic', () => {
    it('should skip extending ruleset that contains the extend as a child', () => {
      // Create .foo ruleset with extend inside
      const fooRuleset = new Ruleset();
      fooRuleset.value.selector = el('.foo');
      const innerRules = new Rules();
      const extendNode = new Extend();
      extendNode.value.target = el('.bar');
      extendNode.value.partial = false;
      innerRules.value.push(extendNode);
      fooRuleset.value.rules = innerRules;
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar ruleset
      const barRuleset = new Ruleset();
      barRuleset.value.selector = el('.bar');
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      // Register extend: .foo extends .bar (but extend is inside .foo)
      context.extends.push([
        el('.bar'),
        el('.foo'),
        false,
        rootRules,
        extendNode
      ]);

      processExtends(context);

      // .bar should NOT be extended because .foo contains the extend
      expect(barRuleset.value.selector.valueOf()).toBe('.bar');
    });
  });

  describe('Phase 2 iterative processing', () => {
    it('should process extended rulesets in Phase 2', () => {
      // Create .foo ruleset
      const fooRuleset = new Ruleset();
      fooRuleset.value.selector = el('.foo');
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar ruleset
      const barRuleset = new Ruleset();
      barRuleset.value.selector = el('.bar');
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      // Register extend: .bar extends .foo
      const extend1 = new Extend();
      extend1.value.target = el('.foo');
      extend1.value.partial = false;
      context.extends.push([
        el('.foo'),
        el('.bar'),
        false,
        rootRules,
        extend1
      ]);

      // Register extend: .baz extends .bar (will match after Phase 1)
      const extend2 = new Extend();
      extend2.value.target = el('.bar');
      extend2.value.partial = false;
      context.extends.push([
        el('.bar'),
        el('.baz'),
        false,
        rootRules,
        extend2
      ]);

      // Create .baz ruleset
      const bazRuleset = new Ruleset();
      bazRuleset.value.selector = el('.baz');
      rootRules.value.push(bazRuleset);
      rootRules.register('ruleset', bazRuleset);

      processExtends(context);

      // Phase 1: .bar extends .foo -> .foo becomes .foo, .bar
      // Phase 2: .baz extends .bar (which is now .foo, .bar) -> .bar becomes .bar, .baz
      // But wait, .bar is in .foo, .bar, so we need to check...
      // Actually, Phase 2 should find that .bar (in the extended .foo, .bar) matches .bar target
      expect(fooRuleset.value.selector.valueOf()).toContainString('.bar');
      expect(barRuleset.value.selector.valueOf()).toContainString('.baz');
    });
  });
});
