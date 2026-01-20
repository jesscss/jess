import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  amp,
  co,
  compound,
  decl,
  el,
  ExtendFlag,
  extend,
  pseudo,
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

  it('extends nested ruleset selector across parent boundary (header/footer)', async () => {
    // Represents:
    // .header {
    //   .header-nav {
    //     background: red;
    //     &:before { background: blue; }
    //   }
    // }
    //
    // .footer {
    //   .footer-nav {
    //     &:extend(.header .header-nav all);
    //   }
    // }
    const root = rules([
      ruleset({
        selector: el('.header'),
        rules: rules([
          ruleset({
            selector: el('.header-nav'),
            rules: rules([
              decl({ name: 'background', value: any('red') }),
              ruleset({
                selector: sel([amp({}), pseudo({ name: ':before' })]),
                rules: rules([
                  decl({ name: 'background', value: any('blue') })
                ])
              })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.footer'),
        rules: rules([
          ruleset({
            selector: el('.footer-nav'),
            rules: rules([
              extend({
                target: sel([el('.header'), co(' '), el('.header-nav')]),
                flag: ExtendFlag.All
              })
            ])
          })
        ])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });

    // Key assertion: `.header .header-nav` gets extended with `.footer .footer-nav`,
    // and the nested `&:before` stays attached under the extended selector.
    expect(css).toContain(':is(.header .header-nav, .footer .footer-nav)');
    expect(css).toContain('background: red');
    expect(css).toContain('&:before');
    expect(css).toContain('background: blue');
  });
});

