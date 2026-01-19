import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  co,
  compound,
  decl,
  el,
  ExtendFlag,
  extend,
  rules,
  ruleset,
  sel,
  sellist
} from '../index.js';

describe('extend integration (eval -> toString)', () => {
  it('extends selectors inside nested rulesets (Less extend-selector replace case)', async () => {
    // Represents:
    // .replace.replace,
    // .c.replace + .replace {
    //   .replace,
    //   .c {
    //     prop: copy-paste-replace;
    //   }
    // }
    // .rep_ace:extend(.replace all) {}

    const root = rules([
      ruleset({
        selector: sellist([
          compound([el('.replace'), el('.replace')]),
          sel([compound([el('.c'), el('.replace')]), co('+'), el('.replace')])
        ]),
        rules: rules([
          ruleset({
            selector: sellist([el('.replace'), el('.c')]),
            rules: rules([
              decl({ name: 'prop', value: any('copy-paste-replace') })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.rep_ace'),
        rules: rules([
          extend({ target: el('.replace'), flag: ExtendFlag.All })
        ])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });

    // Key assertion: the nested `.replace` selector list item is extended.
    expect(css).toContain(':is(.replace, .rep_ace),');
  });
});

