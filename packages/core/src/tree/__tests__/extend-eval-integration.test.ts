import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  amp,
  attr,
  co,
  compound,
  decl,
  el,
  ExtendFlag,
  extend,
  pseudo,
  quoted,
  rules,
  ruleset,
  sel,
  sellist
} from '../index.js';

describe('extend integration (eval -> toString)', () => {
  it('exact extend matches a single OR-branch (does not require all branches)', async () => {
    // Encodes the Less expectation:
    // - Exact matching should succeed if ANY selector-list item can match the extend target by choosing
    //   a single branch inside :is(...), rather than requiring all OR branches to match.
    //
    // Conceptually:
    //   parent:  .replace.replace, .c.replace + .replace { ... }
    //   nested:  & .replace, & .c { ... }
    // materializes to:
    //   :is(.replace.replace, .c.replace + .replace) .replace,
    //   :is(.replace.replace, .c.replace + .replace) .c
    //
    // Exact extend:
    //   .rep_ace:extend(.replace.replace .replace) {}
    //
    // should match the first item by selecting the `.replace.replace` branch from `:is(...)`.

    const parentIs = pseudo({
      name: ':is',
      arg: sellist([
        compound([el('.replace'), el('.replace')]),
        sel([compound([el('.c'), el('.replace')]), co('+'), el('.replace')])
      ])
    });

    const root = rules([
      ruleset({
        selector: sellist([sel([parentIs, co(' '), el('.replace')]), sel([parentIs.copy(true), co(' '), el('.c')])]),
        rules: rules([decl({ name: 'prop', value: any('copy-paste-replace') })])
      }),
      ruleset({
        selector: el('.rep_ace'),
        rules: rules([
          extend({
            target: sel([compound([el('.replace'), el('.replace')]), co(' '), el('.replace')]),
            flag: ExtendFlag.Exact
          })
        ])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });

    // We expect the extend to apply (selector list should include `.rep_ace` at least once).
    expect(css).toContain('.rep_ace');
  });

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

    // Key assertion: the nested `.replace` selector list item is extended and flattened
    // into the selector list (no top-level `:is()` wrapper for the whole item).
    expect(css).toContain('.replace,');
    expect(css).toContain('.rep_ace,');
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
    expect(css).toContain('.header .header-nav,\n.footer .footer-nav');
    expect(css).toContain('background: red');
    expect(css).toContain('&:before');
    expect(css).toContain('background: blue');
  });

  it('extends attribute selectors without duplicating implicit parent prefix (Less extend-selector attributes)', async () => {
    // Represents:
    // .attributes {
    //   [data="test"] { extend: attributes; }
    //   .attribute-test { &:extend([data="test"] all); }
    // }
    const dataTest = attr({ name: 'data', op: '=', value: quoted('test') });

    const root = rules([
      ruleset({
        selector: el('.attributes'),
        rules: rules([
          ruleset({
            selector: dataTest,
            rules: rules([decl({ name: 'extend', value: any('attributes') })])
          }),
          ruleset({
            selector: el('.attribute-test'),
            rules: rules([
              extend({ target: dataTest, flag: ExtendFlag.All })
            ])
          })
        ])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });

    // Key assertions:
    // - we should NOT emit `.attributes :is([data...], .attributes .attribute-test)` (duplicates `.attributes`)
    // - we should keep a single `.attributes { ... }` block with a selector list inside.
    expect(css).not.toContain('.attributes :is(');
    expect(css).toContain('.attributes');
    expect(css).toContain('extend: attributes');
    expect(css).toContain('.attribute-test');
    expect(css).toContain('[data');
  });
});
