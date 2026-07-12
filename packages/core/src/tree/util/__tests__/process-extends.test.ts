import { describe, it, expect } from 'vitest';
import { Context } from '../../../context.js';
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
        ruleset({ selector: el('.foo'), rules: [] }),
        ruleset({
          selector: el('.bar'),
          rules: [extend({ target: el('.foo') })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstRuleset = evald.rules[0] as Ruleset | undefined;
      expect(firstRuleset?.selector?.valueOf()).toBe('.foo,.bar');
    });

    it('should handle multiple extends on same target', async () => {
      const root = rules([
        ruleset({ selector: el('.foo'), rules: [] }),
        ruleset({
          selector: el('.bar'),
          rules: [extend({ target: el('.foo') })]
        }),
        ruleset({
          selector: el('.baz'),
          rules: [extend({ target: el('.foo') })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstRuleset = evald.rules[0] as Ruleset | undefined;
      expect(firstRuleset?.selector?.valueOf()).toBe('.foo,.bar,.baz');
    });

    it('should skip self-referencing extends', async () => {
      const root = rules([
        ruleset({
          selector: el('.foo'),
          rules: [extend({ target: el('.foo') })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstRuleset = evald.rules[0] as Ruleset | undefined;
      expect(firstRuleset?.selector?.valueOf()).toBe('.foo');
    });
  });

  describe('Extend chaining', () => {
    it('should chain extends when extended selector matches another target', async () => {
      const root = rules([
        ruleset({ selector: el('.foo'), rules: [] }),
        ruleset({
          selector: el('.bar'),
          rules: [extend({ target: el('.foo') })]
        }),
        ruleset({
          selector: el('.baz'),
          rules: [extend({ target: el('.bar') })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstRuleset = evald.rules[0] as Ruleset | undefined;
      expect(firstRuleset?.selector?.valueOf()).toBe('.foo,.bar,.baz');
    });
  });

  describe('Partial extends', () => {
    it('should handle partial extends with all flag', async () => {
      const root = rules([
        ruleset({
          selector: compound([el('.a'), el('.b')]),
          rules: []
        }),
        ruleset({
          selector: el('.c'),
          rules: [extend({ target: el('.b'), flag: ExtendFlag.All })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstRuleset = evald.rules[0] as Ruleset | undefined;
      expect(firstRuleset?.selector?.valueOf()).toBe('.a:is(.b,.c)');
    });

    it('should extend every instance of a class when partial is true (Less `all`)', async () => {
      const outerRules = rules([
        ruleset({
          selector: sellist([el('.replace'), el('.c')]),
          rules: []
        })
      ]);
      const root = rules([
        ruleset({
          selector: sellist([
            compound([el('.replace'), el('.replace')]),
            sel([compound([el('.c'), el('.replace')]), co('+'), el('.replace')])
          ]),
          rules: outerRules
        }),
        ruleset({
          selector: el('.rep_ace'),
          rules: [extend({ target: el('.replace'), flag: ExtendFlag.All })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const outerRuleset = evald.rules[0] as Ruleset | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const nestedRuleset = outerRuleset?.rules?.[0] as Ruleset | undefined;
      expect(outerRuleset?.selector?.valueOf()).toBe(
        ':is(.replace,.rep_ace):is(.replace,.rep_ace),.c:is(.replace,.rep_ace)+:is(.replace,.rep_ace)'
      );
      // Selector list order may vary; all three must be present
      const nestedSel = nestedRuleset?.selector?.valueOf() ?? '';
      expect(nestedSel).toContain('.replace');
      expect(nestedSel).toContain('.c');
      expect(nestedSel).toContain('.rep_ace');
    });

    it('should merge multiple partial extends into the same :is() wrapper', async () => {
      const root = rules([
        ruleset({
          selector: sellist([
            sel([el('.foo'), co(' '), el('.bar')]),
            sel([el('.foo'), co(' '), el('.baz')])
          ]),
          rules: []
        }),
        ruleset({
          selector: sel([el('.ext1'), co(' '), el('.ext2')]),
          rules: [extend({ target: el('.foo'), flag: ExtendFlag.All })]
        }),
        ruleset({
          selector: pseudo({ name: ':is', arg: sellist([el('.ext3'), el('.ext4')]) }),
          rules: [extend({ target: el('.foo'), flag: ExtendFlag.All })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstRuleset = evald.rules[0] as Ruleset | undefined;
      expect(firstRuleset?.selector?.valueOf()).toBe(
        ':is(.foo,.ext1 .ext2,.ext3,.ext4) .bar,:is(.foo,.ext1 .ext2,.ext3,.ext4) .baz'
      );
    });
  });

  describe('shouldSkipRuleset logic', () => {
    it('should skip extending ruleset that contains the extend as a child', async () => {
      // .foo { extend(.foo) } only - the extend node is inside .foo, so we must not modify .foo (self-modification guard)
      const root = rules([
        ruleset({
          selector: el('.foo'),
          rules: [extend({ target: el('.foo') })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const firstRuleset = evald.rules[0] as Ruleset | undefined;
      expect(firstRuleset?.selector?.valueOf()).toBe('.foo');
    });
  });

  describe('Phase 2 iterative processing', () => {
    it('should process extended rulesets in Phase 2', async () => {
      const root = rules([
        ruleset({ selector: el('.foo'), rules: [] }),
        ruleset({
          selector: el('.bar'),
          rules: [extend({ target: el('.foo') })]
        }),
        ruleset({
          selector: el('.baz'),
          rules: [extend({ target: el('.bar') })]
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const fooRuleset = evald.rules[0] as Ruleset | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const barRuleset = evald.rules[1] as Ruleset | undefined;
      expect(fooRuleset?.selector?.valueOf()).toContain('.bar');
      expect(barRuleset?.selector?.valueOf()).toContain('.baz');
    });
  });
});
