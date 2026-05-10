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
  decl,
  any,
  ExtendFlag
} from '../../index.js';
import { renderNodeToString } from '../render-buffer.js';

describe('extend serialized target repro', () => {
  it('applies exact extend to the selector that gets serialized', async () => {
    const root = rules([
      ruleset({
        selector: sellist([
          compound([el('.replace'), el('.replace')]),
          sel([compound([el('.c'), el('.replace')]), co('+'), el('.replace')])
        ]),
        rules: rules([
          ruleset({
            selector: sellist([el('.replace'), el('.c')]),
            rules: rules([decl({ name: 'prop', value: any('copy-paste-replace') })])
          })
        ])
      }),
      ruleset({
        selector: el('.rep_ace'),
        rules: rules([
          extend({
            target: sel([compound([el('.replace'), el('.replace')]), co(' '), el('.replace')]),
            flag: ExtendFlag.Exact
          })
        ])
      }),
      ruleset({
        selector: el('.effected'),
        rules: rules([
          extend({
            target: el('.c'),
            flag: ExtendFlag.Exact
          })
        ])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const css = await renderNodeToString(root, context, { context });

    const firstHeader = css.split('{')[0]?.trim() ?? '';
    expect(firstHeader).toContain('.rep_ace');
  });
});
