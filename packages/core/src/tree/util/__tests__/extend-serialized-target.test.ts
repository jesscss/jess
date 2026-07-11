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
  decl,
  any,
  ExtendFlag
} from '../../index.js';
import { renderNodeToString } from '../render-buffer.js';

// D-EVAL FLIP: the spine is the sole TOP-LEVEL render path but does not fold these
// non-eligible root shapes. They render through the RETAINED eval + serialize path —
// reached by supplying a no-op `preSerializeRoot` visitor (the retained post-eval
// render entry) — byte-identical to the pre-flip top-level render (via eval).
const renderRoot = (root: ReturnType<typeof rules>, ctx: Context): Promise<string> =>
  Promise.resolve(renderNodeToString(root, ctx, { context: ctx, preSerializeRoot: r => r }));

describe('extend serialized target repro', () => {
  it('applies exact extend to the selector that gets serialized', async () => {
    const root = rules([
      ruleset({
        selector: sellist([
          compound([el('.replace'), el('.replace')]),
          sel([compound([el('.c'), el('.replace')]), '+', el('.replace')])
        ]),
        rules: [
          ruleset({
            selector: sellist([el('.replace'), el('.c')]),
            rules: [decl({ name: 'prop', value: any('copy-paste-replace') })]
          })
        ]
      }),
      ruleset({
        selector: el('.rep_ace'),
        rules: [
          extend({
            target: sel([compound([el('.replace'), el('.replace')]), ' ', el('.replace')]),
            flag: ExtendFlag.Exact
          })
        ]
      }),
      ruleset({
        selector: el('.effected'),
        rules: [
          extend({
            target: el('.c'),
            flag: ExtendFlag.Exact
          })
        ]
      })
    ]);

    const context = new Context({ output: { collapseNesting: false } });
    const css = await renderRoot(root, context);

    const firstHeader = css.split('{')[0]?.trim() ?? '';
    expect(firstHeader).toContain('.rep_ace');
  });
});
