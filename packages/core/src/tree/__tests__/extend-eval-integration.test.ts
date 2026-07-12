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
    //   :is(.replace.replace, .c.replace + .replace) :is(.replace, .c)
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

    expect(css).toBeString(`
      :is(.replace.replace, .c.replace + .replace) .replace,
      :is(.replace.replace, .c.replace + .replace, .rep_ace) .c,
      .rep_ace {
        prop: copy-paste-replace;
      }
    `);
  });

  it('extends selectors inside nested rulesets (Less extend-selector replace case)', async () => {
    // Progressive reproduction of the Less fixture:
    // - Step 0: no extends → nested output
    // - Step 1: add `.rep_ace:extend(.replace all)` → Less hoists/mixes using `:is(...)`

    const makeRoot = (includeRepAceExtend: boolean) => rules([
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
      ...(includeRepAceExtend
        ? [
          ruleset({
            selector: el('.rep_ace'),
            rules: rules([
              // Less `all` (partial=true)
              extend({ target: el('.replace'), flag: ExtendFlag.All })
            ])
          })
        ]
        : [])
    ]);

    // Step 0
    {
      const context = new Context({ collapseNesting: false });
      const evald = await makeRoot(false).eval(context);
      const css = evald.toString({ context });
      expect(css).toBeString(`
        .replace.replace,
        .c.replace + .replace {
          .replace,
          .c {
            prop: copy-paste-replace;
          }
        }
      `);
    }

    // Step 1 (expected Less output, from `tests-unit/extend-selector/extend-selector.css`)
    {
      const context = new Context({ collapseNesting: false });
      const evald = await makeRoot(true).eval(context);
      const css = evald.toString({ context });
      expect(css).toBeString(`
        :is(.replace, .rep_ace):is(.replace, .rep_ace),
        .c:is(.replace, .rep_ace) + :is(.replace, .rep_ace) {
          .replace,
          .rep_ace,
          .c {
            prop: copy-paste-replace;
          }
        }
      `);
    }
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

    expect(css).toBeString(`
      .header .header-nav,
      .footer .footer-nav {
        background: red;
        &:before {
          background: blue;
        }
      }
    `);
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

    expect(css).toBeString(`
      .attributes {
        [data="test"],
        .attribute-test {
          extend: attributes;
        }
      }
    `);
  });
});
