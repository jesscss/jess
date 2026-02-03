import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  amp,
  attr,
  atrule,
  co,
  color,
  comment,
  compound,
  decl,
  el,
  ExtendFlag,
  extend,
  keyword,
  nil,
  paren,
  pseudo,
  query,
  quoted,
  rules,
  ruleset,
  sel,
  sellist,
  spaced
} from '../index.js';
import { serializeTypes } from '../util/serialize-types.js';

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

  it('extend-media: .all:extend(.ext1 all) at root merges with .ext1 inside and outside @media (Less extend-media.less)', async () => {
    // .ext1 .ext2 { background: black }
    // @media (tv) { .ext1 .ext3 { color: inherit }, .tv-lowres :extend(.ext1 all) { background: blue },
    //   @media (hires) { .ext1 .ext4 { color: green }, .tv-hires :extend(.ext1 all) { background: red } } }
    // .all:extend(.ext1 all) {}
    const root = rules([
      ruleset({
        selector: sellist([sel([el('.ext1'), co(' '), el('.ext2')])]),
        rules: rules([decl({ name: 'background', value: any('black') })])
      }),
      atrule({
        name: any('@media'),
        prelude: any('(tv)'),
        rules: rules([
          ruleset({
            selector: sellist([sel([el('.ext1'), co(' '), el('.ext3')])]),
            rules: rules([decl({ name: 'color', value: any('inherit') })])
          }),
          ruleset({
            selector: el('.tv-lowres'),
            rules: rules([
              decl({ name: 'background', value: any('blue') }),
              extend({ target: el('.ext1'), flag: ExtendFlag.All })
            ])
          }),
          atrule({
            name: any('@media'),
            prelude: any('(hires)'),
            rules: rules([
              ruleset({
                selector: sellist([sel([el('.ext1'), co(' '), el('.ext4')])]),
                rules: rules([decl({ name: 'color', value: any('green') })])
              }),
              ruleset({
                selector: el('.tv-hires'),
                rules: rules([
                  decl({ name: 'background', value: any('red') }),
                  extend({ target: el('.ext1'), flag: ExtendFlag.All })
                ])
              })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.all'),
        rules: rules([extend({ target: el('.ext1'), flag: ExtendFlag.All })])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });

    expect(css).toBeString(`
      :is(.ext1, .all) .ext2 {
        background: black;
      }
      @media (tv) {
        :is(.ext1, .tv-lowres, .all) .ext3 {
          color: inherit;
        }
        .tv-lowres {
          background: blue;
        }
        @media (hires) {
          :is(.ext1, .tv-lowres, .tv-hires, .all) .ext4 {
            color: green;
          }
          .tv-hires {
            background: red;
          }
        }
      }
    `);
  });

  it('extend-chaining media with context.root set before eval (simulates jess getTree)', async () => {
    // Same structure as below; eval sets context.root during preEval (no manual set).
    const root = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([decl({ name: 'color', value: any('black') })])
      }),
      atrule({
        name: any('@media'),
        prelude: any('(tv)'),
        rules: rules([
          ruleset({
            selector: el('.ma'),
            rules: rules([
              decl({ name: 'color', value: any('black') }),
              extend({ target: el('.a') }),
              extend({ target: el('.md') })
            ])
          }),
          ruleset({
            selector: el('.md'),
            rules: rules([decl({ name: 'color', value: any('inherit') })])
          })
        ])
      }),
      ruleset({
        selector: el('.mb'),
        rules: rules([extend({ target: el('.ma') })])
      }),
      ruleset({
        selector: el('.mc'),
        rules: rules([extend({ target: el('.mb') })])
      })
    ]);
    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });
    // Merged selectors (extend applied): .ma, .mb, .mc and .md, .ma, .mb, .mc
    expect(css).toMatch(/\.ma,[\s\S]*?\.mb,[\s\S]*?\.mc\s*\{/);
    expect(css).toMatch(/\.md,[\s\S]*?\.ma,[\s\S]*?\.mb,[\s\S]*?\.mc\s*\{/);
  });

  it('extend-chaining media: inside @media extends outside and .md; outside extends .ma/.mb inside (Less extend-chaining.less media block)', async () => {
    // .a { color: black }
    // @media (tv) { .ma:extend(.a, .md) { color: black }, .md { color: inherit } }
    // .mb:extend(.ma) {} .mc:extend(.mb) {}
    const root = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([decl({ name: 'color', value: any('black') })])
      }),
      atrule({
        name: any('@media'),
        prelude: any('(tv)'),
        rules: rules([
          ruleset({
            selector: el('.ma'),
            rules: rules([
              decl({ name: 'color', value: any('black') }),
              extend({ target: el('.a') }),
              extend({ target: el('.md') })
            ])
          }),
          ruleset({
            selector: el('.md'),
            rules: rules([decl({ name: 'color', value: any('inherit') })])
          })
        ])
      }),
      ruleset({
        selector: el('.mb'),
        rules: rules([extend({ target: el('.ma') })])
      }),
      ruleset({
        selector: el('.mc'),
        rules: rules([extend({ target: el('.mb') })])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });

    expect(css).toBeString(`
      .a {
        color: black;
      }
      @media (tv) {
        .ma,
        .mb,
        .mc {
          color: black;
        }
        .md,
        .ma,
        .mb,
        .mc {
          color: inherit;
        }
      }
    `);
  });

  it('extend-chaining media with SelectorList target (same AST shape as Less parser for .ma:extend(.a,.md))', async () => {
    // Replicate parsed extend-chaining.less: one Extend with target SelectorList([.a, .md])
    // instead of two separate Extend nodes. Ensures processExtend handles SelectorList target
    // when extend is inside @media and targets are at document root.
    const root = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([decl({ name: 'color', value: any('black') })])
      }),
      atrule({
        name: any('@media'),
        prelude: any('(tv)'),
        rules: rules([
          ruleset({
            selector: el('.ma'),
            rules: rules([
              decl({ name: 'color', value: any('black') }),
              extend({ target: sellist([el('.a'), el('.md')]) })
            ])
          }),
          ruleset({
            selector: el('.md'),
            rules: rules([decl({ name: 'color', value: any('inherit') })])
          })
        ])
      }),
      ruleset({
        selector: el('.mb'),
        rules: rules([extend({ target: el('.ma') })])
      }),
      ruleset({
        selector: el('.mc'),
        rules: rules([extend({ target: el('.mb') })])
      })
    ]);

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });

    expect(css).toBeString(`
      .a {
        color: black;
      }
      @media (tv) {
        .ma,
        .mb,
        .mc {
          color: black;
        }
        .md,
        .ma,
        .mb,
        .mc {
          color: inherit;
        }
      }
    `);
  });

  it('extend-chaining.less AST shape: same nodes and selector shapes as parsed (start through @media (tv))', async () => {
    // Same nodes and AST shape as Jess/Less parser for extend-chaining.less from document start
    // through end of @media (tv), plus .mb/.mc so the extend chain resolves. Selector shape:
    // BasicSelector for ruleset selectors; Paren(QueryCondition(Keyword)) for @media prelude;
    // one Extend with SelectorList target for .ma; Extend before Declaration in .ma rules.
    const blackColor = color({ node: 'black', format: 0, rgb: [0, 0, 0], alpha: 1 });
    const maExtendTarget = sellist([
      el('.a'),
      el('.b'),
      el('.c'),
      el('.d'),
      el('.e'),
      el('.f'),
      el('.g'),
      el('.h'),
      el('.i'),
      el('.j'),
      el('.k'),
      el('.l'),
      el('.m'),
      el('.n'),
      el('.o'),
      el('.p'),
      el('.q'),
      el('.r'),
      el('.s'),
      el('.t'),
      el('.u'),
      el('.v'),
      el('.w'),
      el('.x'),
      el('.y'),
      el('.z'),
      el('.md')
    ]);
    const root = rules([
      comment('//very simple chaining'),
      ruleset({
        selector: el('.a'),
        rules: rules([decl({ name: 'color', value: blackColor })])
      }),
      ruleset({ selector: el('.b'), rules: rules([extend({ target: el('.a'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.c'), rules: rules([extend({ target: el('.b'), flag: ExtendFlag.Exact })]) }),
      comment('//very simple chaining, ordering not important'),
      ruleset({ selector: el('.d'), rules: rules([extend({ target: el('.e'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.e'), rules: rules([extend({ target: el('.f'), flag: ExtendFlag.Exact })]) }),
      ruleset({
        selector: el('.f'),
        rules: rules([decl({ name: 'color', value: blackColor })])
      }),
      comment('//extend with all'),
      ruleset({
        selector: compound([el('.g'), el('.h')]),
        rules: rules([decl({ name: 'color', value: blackColor })])
      }),
      ruleset({
        selector: compound([el('.i'), el('.j')]),
        rules: rules([
          extend({ target: el('.g'), flag: ExtendFlag.All }),
          decl({ name: 'color', value: any('inherit') })
        ])
      }),
      ruleset({
        selector: el('.k'),
        rules: rules([extend({ target: el('.i'), flag: ExtendFlag.All })])
      }),
      comment('//extend multi-chaining'),
      ruleset({
        selector: el('.l'),
        rules: rules([decl({ name: 'color', value: blackColor })])
      }),
      ruleset({ selector: el('.m'), rules: rules([extend({ target: el('.l'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.n'), rules: rules([extend({ target: el('.m'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.o'), rules: rules([extend({ target: el('.n'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.p'), rules: rules([extend({ target: el('.o'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.q'), rules: rules([extend({ target: el('.p'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.r'), rules: rules([extend({ target: el('.q'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.s'), rules: rules([extend({ target: el('.r'), flag: ExtendFlag.Exact })]) }),
      ruleset({ selector: el('.t'), rules: rules([extend({ target: el('.s'), flag: ExtendFlag.Exact })]) }),
      comment('// self referencing is ignored'),
      ruleset({
        selector: el('.u'),
        rules: rules([decl({ name: 'color', value: blackColor })])
      }),
      ruleset({
        selector: compound([el('.v'), el('.u'), el('.v')]),
        rules: rules([extend({ target: el('.u'), flag: ExtendFlag.All })])
      }),
      comment('// circular reference because the new extend product will match the existing extend'),
      ruleset({
        selector: el('.w'),
        rules: rules([
          extend({ target: el('.w'), flag: ExtendFlag.Exact }),
          decl({ name: 'color', value: blackColor })
        ])
      }),
      ruleset({
        selector: compound([el('.v'), el('.w'), el('.v')]),
        rules: rules([extend({ target: el('.w'), flag: ExtendFlag.All })])
      }),
      comment('// classic circular references'),
      ruleset({
        selector: el('.x'),
        rules: rules([
          extend({ target: el('.z'), flag: ExtendFlag.Exact }),
          decl({ name: 'color', value: any('x') })
        ])
      }),
      ruleset({
        selector: el('.y'),
        rules: rules([
          extend({ target: el('.x'), flag: ExtendFlag.Exact }),
          decl({ name: 'color', value: any('y') })
        ])
      }),
      ruleset({
        selector: el('.z'),
        rules: rules([
          extend({ target: el('.y'), flag: ExtendFlag.Exact }),
          decl({ name: 'color', value: any('z') })
        ])
      }),
      comment('//very simple chaining, but with the extend inside the ruleset'),
      ruleset({
        selector: el('.va'),
        rules: rules([decl({ name: 'color', value: blackColor })])
      }),
      ruleset({
        selector: el('.vb'),
        rules: rules([
          extend({ target: el('.va'), flag: ExtendFlag.Exact }),
          nil(),
          decl({ name: 'color', value: any('inherit') })
        ])
      }),
      ruleset({
        selector: el('.vc'),
        rules: rules([extend({ target: el('.vb'), flag: ExtendFlag.Exact }), nil()])
      }),
      comment('// media queries - don\'t extend outside, do extend inside'),
      atrule({
        name: any('@media'),
        prelude: paren(query([keyword('tv')])),
        rules: rules([
          ruleset({
            selector: el('.ma'),
            rules: rules([
              extend({ target: maExtendTarget, flag: ExtendFlag.Exact }),
              decl({ name: 'color', value: blackColor })
            ])
          }),
          ruleset({
            selector: el('.md'),
            rules: rules([decl({ name: 'color', value: any('inherit') })])
          }),
          atrule({
            name: any('@media'),
            prelude: paren(query([keyword('plasma')])),
            rules: rules([
              // Parsed structure: inner Rules wrapping Extend then Ruleset (same as snapshot)
              rules([
                extend({
                  selector: sellist([el('.me'), el('.mf')]),
                  target: sellist([el('.mb'), el('.md')]),
                  flag: ExtendFlag.Exact
                }),
                ruleset({
                  selector: sellist([el('.me'), el('.mf')]),
                  rules: rules([
                    nil(),
                    decl({
                      name: 'background',
                      value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                    })
                  ])
                })
              ])
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.mb'),
        rules: rules([extend({ target: el('.ma'), flag: ExtendFlag.Exact })])
      }),
      ruleset({
        selector: el('.mc'),
        rules: rules([extend({ target: el('.mb'), flag: ExtendFlag.Exact })])
      })
    ]);
    const serializeOpts = { showValues: true, maxStringLength: 120 };
    const preEvalSerialized = serializeTypes(root, serializeOpts);
    expect(typeof preEvalSerialized).toBe('string');
    expect(preEvalSerialized).toMatchSnapshot();

    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const postEvalSerialized = serializeTypes(evald, serializeOpts);
    expect(typeof postEvalSerialized).toBe('string');
    expect(postEvalSerialized).toMatchSnapshot();

    const css = evald.toString({ context });
    expect(css).toMatch(/\.ma,[\s\S]*?\.mb,[\s\S]*?\.mc\s*\{/);
    expect(css).toMatch(/\.md,[\s\S]*?\.ma,[\s\S]*?\.mb,[\s\S]*?\.mc\s*\{/);
  });

  it('extend-chaining media with collapseNesting: true - merge must still apply (replicates Jess all-less bug)', async () => {
    // Same structure as "extend-chaining media" but collapseNesting: true.
    // In Jess all-less, extend-chaining.less was run with collapseNesting: true and got unmerged
    // .ma / .md in the media block; extend-chaining-ast-compare used false and passed.
    // Extend merging must be correct regardless of collapseNesting.
    const root = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([decl({ name: 'color', value: any('black') })])
      }),
      atrule({
        name: any('@media'),
        prelude: any('(tv)'),
        rules: rules([
          ruleset({
            selector: el('.ma'),
            rules: rules([
              decl({ name: 'color', value: any('black') }),
              extend({ target: el('.a') }),
              extend({ target: el('.md') })
            ])
          }),
          ruleset({
            selector: el('.md'),
            rules: rules([decl({ name: 'color', value: any('inherit') })])
          })
        ])
      }),
      ruleset({
        selector: el('.mb'),
        rules: rules([extend({ target: el('.ma') })])
      }),
      ruleset({
        selector: el('.mc'),
        rules: rules([extend({ target: el('.mb') })])
      })
    ]);
    const context = new Context({ collapseNesting: true });
    const evald = await root.eval(context);
    const css = evald.toString({ context });
    expect(css).toMatch(/\.ma,[\s\S]*?\.mb,[\s\S]*?\.mc\s*\{/);
    expect(css).toMatch(/\.md,[\s\S]*?\.ma,[\s\S]*?\.mb,[\s\S]*?\.mc\s*\{/);
  });

  /**
   * Minimal tests for extend direction and scope across @media (Less semantics).
   * These assert exact CSS so core matches real Less behavior; Jess must pass these.
   */
  describe('extend and @media: direction and scope (Less semantics)', () => {
    /**
     * A: .b:extend(.a) inside @media cannot reach OUT to root .a.
     * Root .a stays unchanged; .b inside @media gets its own ruleset with .a's declarations (Less copies decls into child root).
     */
    it('A: .b:extend(.a) inside @media cannot reach out - root .a unchanged, .b in media gets .a decls', async () => {
      const root = rules([
        ruleset({
          selector: el('.a'),
          rules: rules([decl({ name: 'color', value: spaced([any('red')]) })])
        }),
        atrule({
          name: any('@media'),
          prelude: any('screen'),
          rules: rules([
            ruleset({
              selector: el('.b'),
              rules: rules([
                decl({ name: 'background', value: spaced([any('blue')]) }),
                extend({ target: el('.a') })
              ])
            })
          ])
        })
      ]);
      const context = new Context({ collapseNesting: false });
      const evald = await root.eval(context);
      const css = evald.toString({ context });
      // Less: .a is NOT merged with .b at root. .b inside @media gets .a's declarations.
      expect(css).toBeString(`
        .a {
          color: red;
        }
        @media screen {
          .b {
            color: red;
            background: blue;
          }
        }
      `);
    });

    /**
     * B: .a:extend(.b) at root CAN reach IN to @media and merge with .b.
     */
    it('B: .a:extend(.b) at root can reach in - .a merged with .b inside @media', async () => {
      const root = rules([
        atrule({
          name: any('@media'),
          prelude: any('screen'),
          rules: rules([
            ruleset({
              selector: el('.b'),
              rules: rules([decl({ name: 'color', value: spaced([any('red')]) })])
            })
          ])
        }),
        ruleset({
          selector: el('.a'),
          rules: rules([
            decl({ name: 'background', value: spaced([any('blue')]) }),
            extend({ target: el('.b') })
          ])
        })
      ]);
      const context = new Context({ collapseNesting: false });
      const evald = await root.eval(context);
      const css = evald.toString({ context });
      expect(css).toBeString(`
        @media screen {
          .b,
          .a {
            color: red;
          }
        }
        .a {
          background: blue;
        }
      `);
    });

    /**
     * C: .c:extend(.b) inside @media extends sibling .b (same extend root).
     */
    it('C: .c:extend(.b) inside @media extends sibling .b - same extend root', async () => {
      const root = rules([
        atrule({
          name: any('@media'),
          prelude: any('screen'),
          rules: rules([
            ruleset({
              selector: el('.b'),
              rules: rules([decl({ name: 'color', value: spaced([any('red')]) })])
            }),
            ruleset({
              selector: el('.c'),
              rules: rules([
                decl({ name: 'background', value: spaced([any('blue')]) }),
                extend({ target: el('.b') })
              ])
            })
          ])
        })
      ]);
      const context = new Context({ collapseNesting: false });
      const evald = await root.eval(context);
      const css = evald.toString({ context });
      expect(css).toBeString(`
        @media screen {
          .b,
          .c {
            color: red;
          }
          .c {
            background: blue;
          }
        }
      `);
    });
  });
});
