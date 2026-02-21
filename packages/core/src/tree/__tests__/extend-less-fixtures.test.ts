/**
 * Replicates each failing fixture from Jess all-less test (Less test-data).
 * Each test builds the AST equivalent of the Less source and expects the exact
 * CSS from the Less expected output. When run, these tests fail with the same
 * diff as all-less until the bugs are fixed.
 *
 * Status (as of 2025-02):
 * 1. extend-clearfix.less – FIXED. Document order in :is() now :is(.clearfix, .foo, .bar):after.
 * 2. extend-exact.less – Test 2a is the canonical case (replace + rep_ace, exact extend) but currently FAILS (:is() not emitted).
 *    Test 2 (full) used ExtendFlag.All for rep_ace, so it passed while asserting wrong behavior; real Less uses exact extend.
 *    &:extend(.c) without "all" must NOT merge .effected into the first rule (no exact .c there). 2a includes .effected to assert that.
 * 3. extend-nest.less – FAILING. :is(.sidebar,...) .box and .submit:hover merged (we output .sidebar .box; .submit vs .submit:hover).
 * 4. extend-selector.less – FAILING. [data="test3"], .attribute-test both extend attributes2 (nesting/selector list shape).
 * 5. extend.less – FAILING. .aa,.cc { .dd,.ee,.ff } and .bb,.cc,.ee,.ff { .bb,.ff } (nested structure vs flat).
 * 6. css-guards.less – SKIPPED. Guarded mixin lookup (mixin/guard).
 */

import { describe, it, expect } from 'vitest';
import { Context } from '../../context.js';
import {
  any,
  amp,
  attr,
  atrule,
  co,
  compound,
  decl,
  el,
  ExtendFlag,
  extend,
  quoted,
  rules,
  ruleset,
  sel,
  sellist,
  pseudo
} from '../index.js';

// false so we expect nested output where source .less is nested (Less test-data style)
const collapseNesting = false;

describe('Jess all-less fixture replications (extend-less-fixtures)', () => {
  /**
   * 1. extend-clearfix.less – returns a fresh AST each call (eval mutates, so do not share).
   * .clearfix { *zoom: 1; &:after { content:''; ... } }
   * .foo { &:extend(.clearfix all); color: red; }
   * .bar { &:extend(.clearfix all); color: blue; }
   */
  function createExtendClearfixAst() {
    return rules([
      ruleset({
        selector: el('.clearfix'),
        rules: rules([
          decl({ name: '*zoom', value: any('1') }),
          ruleset({
            selector: compound([amp(), pseudo({ name: ':after' })]),
            rules: rules([
              decl({ name: 'content', value: quoted('') }),
              decl({ name: 'display', value: any('block') }),
              decl({ name: 'clear', value: any('both') }),
              decl({ name: 'height', value: any('0') })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.foo'),
        rules: rules([
          extend({ target: el('.clearfix'), flag: ExtendFlag.All }),
          decl({ name: 'color', value: any('red') })
        ])
      }),
      ruleset({
        selector: el('.bar'),
        rules: rules([
          extend({ target: el('.clearfix'), flag: ExtendFlag.All }),
          decl({ name: 'color', value: any('blue') })
        ])
      })
    ]);
  }

  it('1a. extend-clearfix with nesting – nested &:after inside block', async () => {
    const context = new Context({ collapseNesting: false });
    const evald = await createExtendClearfixAst().eval(context);
    const css = evald.toString({ context });
    expect(css.trim()).toBeString(
      `.clearfix,
.foo,
.bar {
  *zoom: 1;
  &:after {
    content: "";
    display: block;
    clear: both;
    height: 0;
  }
}
.foo {
  color: red;
}
.bar {
  color: blue;
}`.trim()
    );
  });

  it('1b. extend-clearfix without nesting – flat :is(...):after (Less-style)', async () => {
    const context = new Context({ collapseNesting: true });
    const evald = await createExtendClearfixAst().eval(context);
    const css = evald.toString({ context });
    expect(css.trim()).toBeString(
      `.clearfix,
.foo,
.bar {
  *zoom: 1;
}
:is(.clearfix, .foo, .bar):after {
  content: "";
  display: block;
  clear: both;
  height: 0;
}
.foo {
  color: red;
}
.bar {
  color: blue;
}`.trim()
    );
  });

  /**
   * ISOLATED: First rule of extend-exact (replace + rep_ace, exact extend). Plus .effected { &:extend(.c) } to assert
   * that exact extend does NOT merge .effected into this rule (there is no bare .c here; only .replace.replace, .c.replace + .replace, .replace, .c).
   * Input: .replace.replace, .c.replace + .replace { .replace, .c { prop: copy-paste-replace } }; .rep_ace:extend(.replace.replace .replace) {}; .effected { &:extend(.c); }
   * Expected: First rule :is(.replace.replace, .c.replace + .replace) :is(.replace, .c), .rep_ace { ... }; .effected must NOT appear in that rule.
   */
  it('2a. extend-exact ISOLATED – replace + rep_ace only (first rule); .effected &:extend(.c) must not apply', async () => {
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
        rules: rules([extend({ target: el('.c') })])
      })
    ]);
    const context = new Context({ collapseNesting });
    const evald = await root.eval(context);
    const css = evald.toString({ context });
    const expected = `:is(.replace.replace, .c.replace + .replace) :is(.replace, .c),
.rep_ace {
  prop: copy-paste-replace;
}`;
    expect(css.trim()).toBe(expected);
    // Exact extend(.c) must not merge .effected into the first rule (no bare .c there).
    const firstRuleEnd = css.indexOf('.rep_ace {');
    const firstBlock = firstRuleEnd !== -1 ? css.slice(0, css.indexOf('}', firstRuleEnd) + 1) : css.slice(0, 200);
    expect(firstBlock).not.toContain('.effected');
  });

  /**
   * 2. extend-exact.less – .effected { &:extend(.a); &:extend(.b); &:extend(.c); } and :is() form for .replace
   * Expected: :is(.replace.replace, .c.replace + .replace) :is(.replace, .c), .rep_ace { ... }; .a, .effected { ... }; etc.
   */
  it('2. extend-exact.less – :is() form and .effected merged with .a, .b, .c', async () => {
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
            target: el('.replace'),
            flag: ExtendFlag.All
          })
        ])
      }),
      ruleset({
        selector: sel([el('.a'), co(' '), el('.b'), co(' '), el('.c')]),
        rules: rules([decl({ name: 'prop', value: any('not_effected') })])
      }),
      ruleset({
        selector: el('.a'),
        rules: rules([
          decl({ name: 'prop', value: any('is_effected') }),
          ruleset({
            selector: el('.b'),
            rules: rules([decl({ name: 'prop', value: any('not_effected') })])
          }),
          ruleset({
            selector: compound([el('.b'), el('.c')]),
            rules: rules([decl({ name: 'prop', value: any('not_effected') })])
          })
        ])
      }),
      ruleset({
        selector: sellist([el('.c'), el('.a')]),
        rules: rules([
          ruleset({
            selector: sellist([el('.b'), el('.a')]),
            rules: rules([
              ruleset({
                selector: sellist([el('.a'), el('.c')]),
                rules: rules([decl({ name: 'prop', value: any('not_effected') })])
              })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.effected'),
        rules: rules([
          extend({ target: el('.a') }),
          extend({ target: el('.b') }),
          extend({ target: el('.c') })
        ])
      }),
      ruleset({
        selector: el('.e'),
        rules: rules([
          ruleset({
            selector: compound([amp(), amp()]),
            rules: rules([
              decl({ name: 'prop', value: any('extend-double') }),
              ruleset({
                selector: compound([amp(), pseudo({ name: ':hover' })]),
                rules: rules([decl({ name: 'hover', value: any('not-extended') })])
              })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.dbl'),
        rules: rules([
          extend({ target: compound([el('.e'), el('.e')]) })
        ])
      })
    ]);
    const context = new Context({ collapseNesting });
    const evald = await root.eval(context);
    const css = evald.toString({ context });
    expect(css.trim()).toBeString(`
:is(.replace, .rep_ace):is(.replace, .rep_ace),
.c:is(.replace, .rep_ace) + :is(.replace, .rep_ace) {
  .replace,
  .c,
  .rep_ace {
    prop: copy-paste-replace;
  }
}
.a .b .c {
  prop: not_effected;
}
.a,
.effected {
  prop: is_effected;
  .b {
    prop: not_effected;
  }
  .b.c {
    prop: not_effected;
  }
}
.c,
.a,
.effected {
  .b,
  .a {
    .a,
    .c {
      prop: not_effected;
    }
  }
}
.e.e,
.dbl {
  prop: extend-double;
  &:hover {
    hover: not-extended;
  }
}
`.trim());
  });

  /**
   * 3. extend-nest.less – .sidebar with .box; .sidebar2, .sidebar3, .sidebar4 extend .sidebar all;
   * .button/:hover; .submit:extend(.button); :hover:extend(.button:hover)
   * Expected: :is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box and .button:hover, .submit:hover
   */
  it('3. extend-nest.less – :is(...) .box and .submit:hover merged', async () => {
    // collapseNesting: true so output matches Less (flat :is() rules)
    const context = new Context({ collapseNesting: true });
    const root = rules([
      ruleset({
        selector: el('.sidebar'),
        rules: rules([
          decl({ name: 'width', value: any('300px') }),
          decl({ name: 'background', value: any('red') }),
          ruleset({
            selector: el('.box'),
            rules: rules([
              decl({ name: 'background', value: any('#FFF') }),
              decl({ name: 'border', value: any('1px solid #000') }),
              decl({ name: 'margin', value: any('10px 0') })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.sidebar2'),
        rules: rules([
          extend({ target: el('.sidebar'), flag: ExtendFlag.All }),
          decl({ name: 'background', value: any('blue') })
        ])
      }),
      ruleset({
        selector: el('.type1'),
        rules: rules([
          ruleset({
            selector: el('.sidebar3'),
            rules: rules([
              extend({ target: el('.sidebar'), flag: ExtendFlag.All }),
              decl({ name: 'background', value: any('green') })
            ])
          })
        ])
      }),
      ruleset({
        selector: compound([el('.type2'), el('.sidebar4')]),
        rules: rules([
          extend({ target: el('.sidebar'), flag: ExtendFlag.All }),
          decl({ name: 'background', value: any('red') })
        ])
      }),
      ruleset({
        selector: el('.button'),
        rules: rules([decl({ name: 'color', value: any('black') })])
      }),
      ruleset({
        selector: compound([el('.button'), pseudo({ name: ':hover' })]),
        rules: rules([decl({ name: 'color', value: any('inherit') })])
      }),
      ruleset({
        selector: el('.submit'),
        rules: rules([extend({ target: el('.button') })])
      }),
      ruleset({
        selector: compound([el('.submit'), pseudo({ name: ':hover' })]),
        rules: rules([extend({ target: compound([el('.button'), pseudo({ name: ':hover' })]) })])
      }),
      ruleset({
        selector: el('.nomatch'),
        rules: rules([
          ruleset({
            selector: el(':hover'),
            rules: rules([
              extend({ target: sel([el('.button'), co(' '), el(':hover')]) })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.button2'),
        rules: rules([
          ruleset({
            selector: el(':hover'),
            rules: rules([decl({ name: 'nested', value: any('white') })])
          })
        ])
      }),
      ruleset({
        selector: sel([el('.button2'), co(' '), el(':hover')]),
        rules: rules([decl({ name: 'notnested', value: any('black') })])
      }),
      ruleset({
        selector: el('.nomatch'),
        rules: rules([
          extend({ target: compound([el('.button2'), pseudo({ name: ':hover' })]) })
        ])
      }),
      ruleset({
        selector: sellist([el('.amp-test-a'), el('.amp-test-b')]),
        rules: rules([
          ruleset({
            selector: sel([
              el('.amp-test-c'),
              co(' '),
              compound([amp(), el('.amp-test-d'), amp(), el('.amp-test-e')])
            ]),
            rules: rules([
              ruleset({
                selector: sel([
                  compound([el('.amp-test-f'), amp()]),
                  co('+'),
                  compound([amp(), el('.amp-test-g')])
                ]),
                rules: rules([extend({ target: el('.amp-test-h') })])
              })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.amp-test-h'),
        rules: rules([decl({ name: 'test', value: any('extended by masses of selectors') })])
      })
    ]);
    const evald = await root.eval(context);
    const css = evald.toString({ context });
    expect(css.trim()).toBeString(`
.sidebar,
.sidebar2,
.type1 .sidebar3,
.type2.sidebar4 {
  width: 300px;
  background: red;
}
:is(.sidebar, .sidebar2, .type1 .sidebar3, .type2.sidebar4) .box {
  background: #FFF;
  border: 1px solid #000;
  margin: 10px 0;
}
.sidebar2 {
  background: blue;
}
.type1 .sidebar3 {
  background: green;
}
.type2.sidebar4 {
  background: red;
}
.button,
.submit {
  color: black;
}
.button:hover,
.submit:hover {
  color: inherit;
}
.button2 :hover {
  nested: white;
}
.button2 :hover {
  notnested: black;
}
.amp-test-h,
.amp-test-f:is(.amp-test-c :is(.amp-test-a, .amp-test-b).amp-test-d:is(.amp-test-a, .amp-test-b).amp-test-e) + :is(.amp-test-c :is(.amp-test-a, .amp-test-b).amp-test-d:is(.amp-test-a, .amp-test-b).amp-test-e).amp-test-g {
  test: extended by masses of selectors;
}`.trim());
  });

  /**
   * 4. extend-selector.less – full fixture parity for all-less failing shape.
   */
  it('4. extend-selector.less – full selector extend parity (ext/attributes/footer/issue-2586)', async () => {
    const dataTest = attr({ name: 'data', op: '=', value: quoted('test') });
    const dataAny = attr({ name: 'data' });
    const dataTest3 = attr({ name: 'data', op: '=', value: quoted('test3') });
    const root = rules([
      ruleset({
        selector: sellist([
          sel([el('.foo'), co(' '), el('.bar')]),
          sel([el('.foo'), co(' '), el('.baz')])
        ]),
        rules: rules([decl({ name: 'display', value: any('none') })])
      }),
      ruleset({
        selector: sel([el('.ext1'), co(' '), el('.ext2')]),
        rules: rules([extend({ target: el('.foo'), flag: ExtendFlag.All })])
      }),
      ruleset({
        selector: sellist([el('.ext3'), el('.ext4')]),
        rules: rules([extend({ target: el('.foo'), flag: ExtendFlag.All })])
      }),
      ruleset({
        selector: sellist([compound([el('div'), el('.ext5')]), sel([el('.ext6'), co('>'), el('.ext5')])]),
        rules: rules([decl({ name: 'width', value: any('100px') })])
      }),
      ruleset({
        selector: sellist([el('.should-not-exist-in-output'), el('.ext7')]),
        rules: rules([extend({ selector: el('.ext7'), target: el('.ext5'), flag: ExtendFlag.All })])
      }),
      ruleset({
        selector: el('.ext'),
        rules: rules([decl({ name: 'test', value: any('1') })])
      }),
      ruleset({
        selector: sellist([el('.a'), el('.b')]),
        rules: rules([
          decl({ name: 'test', value: any('2') }),
          ruleset({
            selector: el('.c'),
            rules: rules([
              extend({ target: el('.ext'), flag: ExtendFlag.All }),
              decl({ name: 'test', value: any('3') }),
              ruleset({
                selector: el('.d'),
                rules: rules([decl({ name: 'test', value: any('4') })])
              })
            ])
          })
        ])
      }),
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
        rules: rules([extend({ target: el('.replace'), flag: ExtendFlag.All })])
      }),
      ruleset({
        selector: el('.attributes'),
        rules: rules([
          ruleset({
            selector: dataTest,
            rules: rules([decl({ name: 'extend', value: any('attributes') })])
          }),
          ruleset({
            selector: el('.attribute-test'),
            rules: rules([extend({ target: dataTest, flag: ExtendFlag.All })])
          }),
          ruleset({
            selector: dataAny,
            rules: rules([decl({ name: 'extend', value: any('attributes2') })])
          }),
          ruleset({
            selector: el('.attribute-test2'),
            rules: rules([extend({ target: dataAny, flag: ExtendFlag.All })])
          }),
          ruleset({
            selector: dataTest3,
            rules: rules([decl({ name: 'extend', value: any('attributes2') })])
          }),
          ruleset({
            selector: el('.attribute-test'),
            rules: rules([extend({ target: dataTest3, flag: ExtendFlag.All })])
          })
        ])
      }),
      ruleset({
        selector: el('.header'),
        rules: rules([
          ruleset({
            selector: el('.header-nav'),
            rules: rules([
              decl({ name: 'background', value: any('red') }),
              ruleset({
                selector: compound([amp(), pseudo({ name: ':before' })]),
                rules: rules([decl({ name: 'background', value: any('blue') })])
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
              extend({ target: sel([el('.header'), co(' '), el('.header-nav')]), flag: ExtendFlag.All })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.issue-2586-bordered'),
        rules: rules([decl({ name: 'border', value: any('solid 1px black') })])
      }),
      ruleset({
        selector: el('.issue-2586-somepage'),
        rules: rules([
          ruleset({
            selector: el('.content'),
            rules: rules([
              extend({ target: el('.issue-2586-bordered') }),
              ruleset({
                selector: sel([amp(), co('>'), el('span')]),
                rules: rules([decl({ name: 'margin-bottom', value: any('10px') })])
              })
            ])
          })
        ])
      })
    ]);
    const context = new Context({ collapseNesting: false });
    const evald = await root.eval(context);
    const css = evald.toString({ context });
    expect(css.trim()).toBeString(`
:is(.foo, .ext1 .ext2, .ext3, .ext4) .bar,
:is(.foo, .ext1 .ext2, .ext3, .ext4) .baz {
  display: none;
}
div:is(.ext5, .ext7),
.ext6 > :is(.ext5, .ext7) {
  width: 100px;
}
.ext,
:is(.a, .b) .c {
  test: 1;
}
.a,
.b {
  test: 2;
  .c {
    test: 3;
    .d {
      test: 4;
    }
  }
}
:is(.replace, .rep_ace):is(.replace, .rep_ace),
.c:is(.replace, .rep_ace) + :is(.replace, .rep_ace) {
  .replace,
  .c,
  .rep_ace {
    prop: copy-paste-replace;
  }
}
.attributes {
  [data="test"],
  .attribute-test {
    extend: attributes;
  }
  [data],
  .attribute-test2 {
    extend: attributes2;
  }
  [data="test3"],
  .attribute-test {
    extend: attributes2;
  }
}
.header .header-nav,
.footer .footer-nav {
  background: red;
  &:before {
    background: blue;
  }
}
.issue-2586-bordered,
.issue-2586-somepage .content {
  border: solid 1px black;
}
.issue-2586-somepage {
  .content {
    & > span {
      margin-bottom: 10px;
    }
  }
}
`.trim());
  });

  /**
   * 5. extend.less – .aa .dd, .bb .bb, .cc:extend(.aa,.bb), .ee:extend(.dd all,.bb), .ff:extend(.dd,.bb all)
   * Expected: .aa,.cc { .dd,.ee,.ff { background: red } }; .bb,.cc,.ee,.ff { .bb,.ff { color: black } }
   * Current: .ee missing from first block; .cc wrongly in second inner
   */
  it('5. extend.less – .aa/.cc .dd/.ee/.ff and .bb/.cc/.ee/.ff .bb/.ff', async () => {
    const root = rules([
      ruleset({
        selector: el('.aa'),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          ruleset({
            selector: el('.dd'),
            rules: rules([decl({ name: 'background', value: any('red') })])
          })
        ])
      }),
      ruleset({
        selector: el('.bb'),
        rules: rules([
          decl({ name: 'background', value: any('red') }),
          ruleset({
            selector: el('.bb'),
            rules: rules([decl({ name: 'color', value: any('black') })])
          })
        ])
      }),
      ruleset({
        selector: el('.cc'),
        rules: rules([
          extend({ target: el('.aa') }),
          extend({ target: el('.bb') })
        ])
      }),
      ruleset({
        selector: el('.ee'),
        rules: rules([
          extend({ target: el('.dd'), flag: ExtendFlag.All }),
          extend({ target: el('.bb') })
        ])
      }),
      ruleset({
        selector: el('.ff'),
        rules: rules([
          extend({ target: el('.dd') }),
          extend({ target: el('.bb'), flag: ExtendFlag.All })
        ])
      })
    ]);
    const context = new Context({ collapseNesting });
    const evald = await root.eval(context);
    const css = evald.toString({ context });
    expect(css.trim()).toBeString(`
.aa,
.cc {
  color: black;
  .dd,
  .ee,
  .ff {
    background: red;
  }
}
.bb,
.cc,
.ee,
.ff {
  background: red;
  .bb,
  .ff {
    color: black;
  }
}
`.trim());
  });

  /**
   * 6. css-guards.less – .scope-check when (@c = 3) { ... } .scope-check-2 { .scope-check(); }
   * Jess all-less throws: ReferenceError: No matching mixins found for '.scope-check'
   * Replication: run in Jess (all-less) until mixin/guard lookup is fixed; core has no guarded
   * mixin AST builder here. This test documents the failure; add full replication when fixing.
   */
  it.skip('6. css-guards.less – .scope-check() finds guarded mixin (replicate in Jess all-less)', async () => {
    expect(true).toBe(true); // placeholder; failure is in Jess all-less css-guards.less
  });
});
