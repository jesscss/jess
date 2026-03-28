import { describe, it, expect } from 'vitest';
import { Context } from '../../../context.js';
import { tryExtendSelector } from '../extend-core.js';
import {
  rules,
  ruleset,
  extend,
  el,
  compound,
  sellist,
  sel,
  co,
  pseudo,
  ExtendFlag,
  type Ruleset
} from '../../index.js';

/**
 * processExtends behavior is tested via the real eval flow: build AST as the parser would
 * (rules with rulesets that contain extend() nodes), call root.eval(context), then assert.
 * No manual context.root, context.extendRoots.registerRoot, or context.extends.push.
 */
describe('processExtends function (eval flow)', () => {
  describe('Basic extend processing', () => {
    it('should extend a simple ruleset', async () => {
      const root = rules([
        ruleset({ selector: el('.foo'), rules: rules([]) }),
        ruleset({
          selector: el('.bar'),
          rules: rules([extend({ target: el('.foo') })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.at(0, context) as Ruleset | undefined;
      expect(firstRuleset?.getEffectiveSelector?.(false, context).valueOf()).toBe('.foo,.bar');
    });

    it('should handle multiple extends on same target', async () => {
      const root = rules([
        ruleset({ selector: el('.foo'), rules: rules([]) }),
        ruleset({
          selector: el('.bar'),
          rules: rules([extend({ target: el('.foo') })])
        }),
        ruleset({
          selector: el('.baz'),
          rules: rules([extend({ target: el('.foo') })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.at(0, context) as Ruleset | undefined;
      expect(firstRuleset?.getEffectiveSelector?.(false, context).valueOf()).toBe('.foo,.bar,.baz');
    });

    it('should skip self-referencing extends', async () => {
      const root = rules([
        ruleset({
          selector: el('.foo'),
          rules: rules([extend({ target: el('.foo') })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.at(0, context) as Ruleset | undefined;
      expect(firstRuleset?.getEffectiveSelector?.(false, context).valueOf()).toBe('.foo');
    });
  });

  describe('Extend chaining', () => {
    it('should chain extends when extended selector matches another target', async () => {
      const root = rules([
        ruleset({ selector: el('.foo'), rules: rules([]) }),
        ruleset({
          selector: el('.bar'),
          rules: rules([extend({ target: el('.foo') })])
        }),
        ruleset({
          selector: el('.baz'),
          rules: rules([extend({ target: el('.bar') })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.at(0, context) as Ruleset | undefined;
      expect(firstRuleset?.getEffectiveSelector?.(false, context).valueOf()).toBe('.foo,.bar,.baz');
    });
  });

  describe('Partial extends', () => {
    it('should handle partial extends with all flag', async () => {
      const targetSelector = compound([el('.a'), el('.b')]);
      const extendSelector = el('.c');
      const root = rules([
        ruleset({
          selector: targetSelector,
          rules: rules([])
        }),
        ruleset({
          selector: extendSelector,
          rules: rules([extend({ target: el('.b'), flag: ExtendFlag.All })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.at(0, context) as Ruleset | undefined;
      const expected = tryExtendSelector(
        targetSelector.copy(true),
        el('.b'),
        extendSelector.copy(true),
        true
      );
      expect(firstRuleset?.getEffectiveSelector?.(false, context).valueOf()).toBe(expected.value.valueOf());
    });

    it('should apply partial extends to the outer ruleset selector when partial is true (Less `all`)', async () => {
      const targetSelector = sellist([
        compound([el('.replace'), el('.replace')]),
        sel([compound([el('.c'), el('.replace')]), co('+'), el('.replace')])
      ]);
      const extendSelector = el('.rep_ace');
      const outerRules = rules([
        ruleset({
          selector: sellist([el('.replace'), el('.c')]),
          rules: rules([])
        })
      ]);
      const root = rules([
        ruleset({
          selector: targetSelector,
          rules: outerRules
        }),
        ruleset({
          selector: extendSelector,
          rules: rules([extend({ target: el('.replace'), flag: ExtendFlag.All })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const outerRuleset = evald.at(0, context) as Ruleset | undefined;
      const nestedRuleset = outerRuleset?.rules?.value?.[0];
      const expected = tryExtendSelector(
        targetSelector.copy(true),
        el('.replace'),
        extendSelector.copy(true),
        true
      );
      expect(outerRuleset?.getEffectiveSelector?.(false, context).valueOf()).toBe(expected.value.valueOf());
      // Nested selectors stay defined and keep their existing structure.
      const nestedSel = nestedRuleset?.selector?.valueOf() ?? '';
      expect(nestedSel).toContain('.replace');
      expect(nestedSel).toContain('.c');
      expect(nestedSel.length).toBeGreaterThan(0);
    });

    it('should apply multiple partial extends in sequence', async () => {
      const targetSelector = sellist([
        sel([el('.foo'), co(' '), el('.bar')]),
        sel([el('.foo'), co(' '), el('.baz')])
      ]);
      const firstExtend = sel([el('.ext1'), co(' '), el('.ext2')]);
      const secondExtend = pseudo({ name: ':is', arg: sellist([el('.ext3'), el('.ext4')]) });
      const root = rules([
        ruleset({
          selector: targetSelector,
          rules: rules([])
        }),
        ruleset({
          selector: firstExtend,
          rules: rules([extend({ target: el('.foo'), flag: ExtendFlag.All })])
        }),
        ruleset({
          selector: secondExtend,
          rules: rules([extend({ target: el('.foo'), flag: ExtendFlag.All })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.at(0, context) as Ruleset | undefined;
      const output = firstRuleset?.getEffectiveSelector?.(false, context).valueOf() ?? '';
      expect(output).toContain('.ext1 .ext2');
      expect(output).toContain('.ext3,.ext4');
      expect(output).toContain('.bar');
      expect(output).toContain('.baz');
    });
  });

  describe('shouldSkipRuleset logic', () => {
    it('should skip extending ruleset that contains the extend as a child', async () => {
      // .foo { extend(.foo) } only - the extend node is inside .foo, so we must not modify .foo (self-modification guard)
      const root = rules([
        ruleset({
          selector: el('.foo'),
          rules: rules([extend({ target: el('.foo') })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.at(0, context) as Ruleset | undefined;
      expect(firstRuleset?.getEffectiveSelector?.(false, context).valueOf()).toBe('.foo');
    });
  });

  describe('Phase 2 iterative processing', () => {
    it('should process extended rulesets in Phase 2', async () => {
      const root = rules([
        ruleset({ selector: el('.foo'), rules: rules([]) }),
        ruleset({
          selector: el('.bar'),
          rules: rules([extend({ target: el('.foo') })])
        }),
        ruleset({
          selector: el('.baz'),
          rules: rules([extend({ target: el('.bar') })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const fooRuleset = evald.at(0, context) as Ruleset | undefined;
      const barRuleset = evald.at(1, context) as Ruleset | undefined;
      expect(fooRuleset?.getEffectiveSelector?.(false, context).valueOf()).toContain('.bar');
      expect(barRuleset?.getEffectiveSelector?.(false, context).valueOf()).toContain('.baz');
    });
  });
});
