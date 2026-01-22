import { describe, it, expect, beforeEach } from 'vitest';
import { Context } from '../../../context.js';
import { rules, ruleset, extend, el, compound, sellist, sel, co, pseudo, type Rules } from '../../index.js';
import { processExtends } from '../extend-roots.js';

describe('processExtends function', () => {
  let context: Context;
  let rootRules: Rules;

  beforeEach(() => {
    context = new Context();
    rootRules = rules([]);
    context.root = rootRules;
    context.extendRoots.root = rootRules;
    context.extendRoots.registerRoot(rootRules);
  });

  describe('Basic extend processing', () => {
    it('should extend a simple ruleset', () => {
      // Create .foo ruleset
      const fooRuleset = ruleset({ selector: el('.foo'), rules: rules([]) });
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar:extend(.foo) ruleset
      const barRuleset = ruleset({ selector: el('.bar'), rules: rules([]) });
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      // Register extend: .bar extends .foo
      const extendNode = extend({ target: el('.foo') });
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
      const fooRuleset = ruleset({ selector: el('.foo'), rules: rules([]) });
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar and .baz rulesets
      const barRuleset = ruleset({ selector: el('.bar'), rules: rules([]) });
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      const bazRuleset = ruleset({ selector: el('.baz'), rules: rules([]) });
      rootRules.value.push(bazRuleset);
      rootRules.register('ruleset', bazRuleset);

      // Register extends: .bar extends .foo, .baz extends .foo
      const extend1 = extend({ target: el('.foo') });
      context.extends.push([
        el('.foo'),
        el('.bar'),
        false,
        rootRules,
        extend1
      ]);

      const extend2 = extend({ target: el('.foo') });
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
      const fooRuleset = ruleset({ selector: el('.foo'), rules: rules([]) });
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Register extend: .foo extends .foo (self-reference)
      const extendNode = extend({ target: el('.foo') });
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
      const fooRuleset = ruleset({ selector: el('.foo'), rules: rules([]) });
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar ruleset
      const barRuleset = ruleset({ selector: el('.bar'), rules: rules([]) });
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      // Create .baz ruleset
      const bazRuleset = ruleset({ selector: el('.baz'), rules: rules([]) });
      rootRules.value.push(bazRuleset);
      rootRules.register('ruleset', bazRuleset);

      // Register extends:
      // 1. .bar extends .foo
      // 2. .baz extends .bar
      const extend1 = extend({ target: el('.foo') });
      context.extends.push([
        el('.foo'),
        el('.bar'),
        false,
        rootRules,
        extend1
      ]);

      const extend2 = extend({ target: el('.bar') });
      context.extends.push([
        el('.bar'),
        el('.baz'),
        false,
        rootRules,
        extend2
      ]);

      processExtends(context);

      // Chaining behavior:
      // 1) .bar extends .foo  => .foo becomes .foo,.bar
      // 2) .baz extends .bar  => any selector containing .bar also gets .baz
      // so .foo becomes .foo,.bar,.baz
      expect(fooRuleset.value.selector.valueOf()).toBe('.foo,.bar,.baz');
    });
  });

  describe('Partial extends', () => {
    it('should handle partial extends with all flag', () => {
      // Create .a .b ruleset
      const abRuleset = ruleset({ selector: compound([el('.a'), el('.b')]), rules: rules([]) });
      rootRules.value.push(abRuleset);
      rootRules.register('ruleset', abRuleset);

      // Create .c ruleset
      const cRuleset = ruleset({ selector: el('.c'), rules: rules([]) });
      rootRules.value.push(cRuleset);
      rootRules.register('ruleset', cRuleset);

      // Register extend: .c extends .b (partial)
      const extendNode = extend({ target: el('.b') });
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

    it('should extend every instance of a class when partial is true (Less `all`)', () => {
      // Represents:
      // .replace.replace,
      // .c.replace + .replace {
      //   .replace,
      //   .c {
      //     prop: copy-paste-replace;
      //   }
      // }
      // .rep_ace:extend(.replace all) {}

      // Outer selector list: `.replace.replace, .c.replace + .replace`
      const outerRules = rules([]);
      const outerRuleset = ruleset({
        selector: sellist([
          compound([el('.replace'), el('.replace')]),
          sel([compound([el('.c'), el('.replace')]), co('+'), el('.replace')])
        ]),
        rules: outerRules
      });

      rootRules.value.push(outerRuleset);
      rootRules.register('ruleset', outerRuleset);

      // Nested ruleset selector list: `.replace, .c`
      const nestedRuleset = ruleset({
        selector: sellist([el('.replace'), el('.c')]),
        rules: rules([])
      });
      outerRules.value.push(nestedRuleset);
      outerRules.register('ruleset', nestedRuleset);

      // Treat the nested rules block as an extend root accessible from root
      context.extendRoots.registerRoot(outerRules, rootRules);

      // Register extend: `.rep_ace` extends `.replace` (partial=true => Less `all`)
      const extendNode = extend({ target: el('.replace') });
      context.extends.push([
        el('.replace'),     // target
        el('.rep_ace'),     // selectorWithExtend
        true,               // partial (Less `all`)
        rootRules,          // extendRoot
        extendNode          // extendNode
      ]);

      processExtends(context);

      // Expected:
      // :is(.replace, .rep_ace):is(.replace, .rep_ace),
      // .c:is(.replace, .rep_ace) + :is(.replace, .rep_ace) { ... }
      expect(outerRuleset.value.selector.valueOf()).toBe(
        ':is(.replace,.rep_ace):is(.replace,.rep_ace),.c:is(.replace,.rep_ace)+:is(.replace,.rep_ace)'
      );

      // Expected nested:
      // .replace, .rep_ace, .c { ... }
      // Since the :is() wrapper is generated by extend and is the whole selector-list item,
      // normalization unwraps/merges it into the parent selector list.
      expect(nestedRuleset.value.selector.valueOf()).toBe('.replace,.c,.rep_ace');
    });

    it('should merge multiple partial extends into the same :is() wrapper', () => {
      // Represents (from extend-selector.less):
      // .foo .bar, .foo .baz { ... }
      // .ext1 .ext2 { &:extend(.foo all) }
      // .ext3, .ext4 { &:extend(.foo all) }
      const fooRuleset = ruleset({
        selector: sellist([
          sel([el('.foo'), co(' '), el('.bar')]),
          sel([el('.foo'), co(' '), el('.baz')])
        ]),
        rules: rules([])
      });
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      const extend1 = extend({ target: el('.foo') });
      context.extends.push([
        el('.foo'),
        sel([el('.ext1'), co(' '), el('.ext2')]),
        true,
        rootRules,
        extend1
      ]);

      const extend2 = extend({ target: el('.foo') });
      context.extends.push([
        el('.foo'),
        // Less-style selector list should contribute each entry as an alternative.
        pseudo({ name: ':is', arg: sellist([el('.ext3'), el('.ext4')]) }),
        true,
        rootRules,
        extend2
      ]);

      processExtends(context);

      expect(fooRuleset.value.selector.valueOf()).toBe(
        ':is(.foo,.ext1 .ext2,.ext3,.ext4) .bar,:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz'
      );
    });
  });

  describe('shouldSkipRuleset logic', () => {
    it('should skip extending ruleset that contains the extend as a child', () => {
      // The extend node is a child of the *target* ruleset (.foo),
      // so `.bar extends .foo` should NOT modify `.foo` (self-modification guard).
      const extendNode = extend({ target: el('.foo') });
      const innerRules = rules([extendNode]);
      const fooRuleset = ruleset({ selector: el('.foo'), rules: innerRules });
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Register extend: .bar extends .foo (but the extend node lives inside .foo)
      context.extends.push([
        el('.foo'),
        el('.bar'),
        false,
        rootRules,
        extendNode
      ]);

      processExtends(context);

      // `.foo` should remain unchanged
      expect(fooRuleset.value.selector.valueOf()).toBe('.foo');
    });
  });

  describe('Phase 2 iterative processing', () => {
    it('should process extended rulesets in Phase 2', () => {
      // Create .foo ruleset
      const fooRuleset = ruleset({ selector: el('.foo'), rules: rules([]) });
      rootRules.value.push(fooRuleset);
      rootRules.register('ruleset', fooRuleset);

      // Create .bar ruleset
      const barRuleset = ruleset({ selector: el('.bar'), rules: rules([]) });
      rootRules.value.push(barRuleset);
      rootRules.register('ruleset', barRuleset);

      // Register extend: .bar extends .foo
      const extend1 = extend({ target: el('.foo') });
      context.extends.push([
        el('.foo'),
        el('.bar'),
        false,
        rootRules,
        extend1
      ]);

      // Register extend: .baz extends .bar (will match after Phase 1)
      const extend2 = extend({ target: el('.bar') });
      context.extends.push([
        el('.bar'),
        el('.baz'),
        false,
        rootRules,
        extend2
      ]);

      // Create .baz ruleset
      const bazRuleset = ruleset({ selector: el('.baz'), rules: rules([]) });
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
