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
  ExtendFlag
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
      const firstRuleset = evald.data[0] as any;
      expect(firstRuleset?.data?.selector?.valueOf()).toBe('.foo,.bar');
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
      const firstRuleset = evald.data[0] as any;
      expect(firstRuleset?.data?.selector?.valueOf()).toBe('.foo,.bar,.baz');
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
      const firstRuleset = evald.data[0] as any;
      expect(firstRuleset?.data?.selector?.valueOf()).toBe('.foo');
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
      const firstRuleset = evald.data[0] as any;
      expect(firstRuleset?.data?.selector?.valueOf()).toBe('.foo,.bar,.baz');
    });
  });

  describe('Partial extends', () => {
    it('should handle partial extends with all flag', async () => {
      const root = rules([
        ruleset({
          selector: compound([el('.a'), el('.b')]),
          rules: rules([])
        }),
        ruleset({
          selector: el('.c'),
          rules: rules([extend({ target: el('.b'), flag: ExtendFlag.All })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.data[0] as any;
      expect(firstRuleset?.data?.selector?.valueOf()).toBe('.a:is(.b,.c)');
    });

    it('should extend every instance of a class when partial is true (Less `all`)', async () => {
      const outerRules = rules([
        ruleset({
          selector: sellist([el('.replace'), el('.c')]),
          rules: rules([])
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
          rules: rules([extend({ target: el('.replace'), flag: ExtendFlag.All })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const outerRuleset = evald.data[0] as any;
      const nestedRuleset = outerRuleset?.data?.rules?.data?.[0];
      expect(outerRuleset?.data?.selector?.valueOf()).toBe(
        ':is(.replace,.rep_ace):is(.replace,.rep_ace),.c:is(.replace,.rep_ace)+:is(.replace,.rep_ace)'
      );
      // Selector list order may vary; all three must be present
      const nestedSel = nestedRuleset?.data?.selector?.valueOf() ?? '';
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
          rules: rules([])
        }),
        ruleset({
          selector: sel([el('.ext1'), co(' '), el('.ext2')]) as any,
          rules: rules([extend({ target: el('.foo'), flag: ExtendFlag.All })])
        }),
        ruleset({
          selector: pseudo({ name: ':is', arg: sellist([el('.ext3'), el('.ext4')]) }),
          rules: rules([extend({ target: el('.foo'), flag: ExtendFlag.All })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.data[0] as any;
      expect(firstRuleset?.data?.selector?.valueOf()).toBe(
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
          rules: rules([extend({ target: el('.foo') })])
        })
      ]);
      const context = new Context();
      const evald = await root.eval(context);
      const firstRuleset = evald.data[0] as any;
      expect(firstRuleset?.data?.selector?.valueOf()).toBe('.foo');
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
      const fooRuleset = evald.data[0] as any;
      const barRuleset = evald.data[1] as any;
      expect(fooRuleset?.data?.selector?.valueOf()).toContain('.bar');
      expect(barRuleset?.data?.selector?.valueOf()).toContain('.baz');
    });
  });
});
