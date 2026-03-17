import { expectFlags, DEFAULT_VARIABLE } from './helpers.js';
import { rules, ruleset, sellist, sel, el, decl, any, list, num, op, call, ref, paren, negative, atrule, interpolated, interpolatedSelector, type Ruleset, type Declaration } from '../src/index.js';

describe('Flag isolation', () => {
  describe('MayAsync isolation (siblings do not bleed)', () => {
    test('sibling rulesets', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([decl({ name: 'color', value: DEFAULT_VARIABLE })])
        }),
        ruleset({
          selector: sellist([sel([el('.b')])]),
          rules: rules([decl({ name: 'color', value: any('red') })])
        })
      ]);
      const r1 = tree.value[0]! as Ruleset;
      const r2 = tree.value[1]! as Ruleset;
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling at-rules', () => {
      const tree = rules([
        atrule({
          name: any('media'),
          prelude: any('(min-width: 10px)'),
          rules: rules([decl({ name: 'color', value: DEFAULT_VARIABLE })])
        }),
        atrule({
          name: any('media'),
          prelude: any('(min-width: 10px)'),
          rules: rules([decl({ name: 'color', value: any('red') })])
        })
      ]);
      const a1 = tree.value[0]!;
      const a2 = tree.value[1]!;
      expectFlags(a1, false, true); // mayAsync
      expectFlags(a2, true, false); // static
    });

    test('sibling declarations: Paren', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'p1', value: paren(ref('@v', { type: 'variable' })) }),
            decl({ name: 'p2', value: paren(any('1')) })
          ])
        })
      ]);
      const rs = tree.value[0]! as Ruleset;
      const inner = rs.rules;
      const d1 = inner.value[0]! as Declaration;
      const d2 = inner.value[1]! as Declaration;
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, true, false); // static
    });

    test('sibling declarations: Block', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'b1', value: list([ref('@v', { type: 'variable' })]) }),
            decl({ name: 'b2', value: list([any('1')]) })
          ])
        })
      ]);
      const rs = tree.value[0]! as Ruleset;
      const inner = rs.rules;
      const d1 = inner.value[0]! as Declaration;
      const d2 = inner.value[1]! as Declaration;
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, true, false); // static
    });

    test('sibling declarations: Operation', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'o1', value: op([num(1), '+', ref('@v', { type: 'variable' })]) }),
            decl({ name: 'o2', value: op([num(1), '+', num(2)]) })
          ])
        })
      ]);
      const rs = tree.value[0]! as Ruleset;
      const inner = rs.rules;
      const d1 = inner.value[0]! as Declaration;
      const d2 = inner.value[1]! as Declaration;
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, false, false); // non-static but not mayAsync
    });

    test('sibling declarations: Negative', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'n1', value: negative(ref('@v', { type: 'variable' })) }),
            decl({ name: 'n2', value: negative(any('1')) })
          ])
        })
      ]);
      const rs = tree.value[0]! as Ruleset;
      const inner = rs.rules;
      const d1 = inner.value[0]! as Declaration;
      const d2 = inner.value[1]! as Declaration;
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, false, false); // non-static but not mayAsync
    });

    test('sibling declarations: Call', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'c1', value: call({ name: 'rgb', args: list([ref('@v', { type: 'variable' }), any('1'), any('1')]) }) }),
            decl({ name: 'c2', value: call({ name: 'rgb', args: list([any('1'), any('1'), any('1')]) }) })
          ])
        })
      ]);
      const rs = tree.value[0]! as Ruleset;
      const inner = rs.rules;
      const d1 = inner.value[0]! as Declaration;
      const d2 = inner.value[1]! as Declaration;
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, false, true); // mayAsync (function calls are always mayAsync)
    });

    test('sibling rulesets: pseudo selector with selector-child', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a:has('), interpolatedSelector(interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })), el(')')])]),
          rules: rules([decl({ name: 'y', value: any('1') })])
        }),
        ruleset({
          selector: sellist([sel([el('.b:has(.c')])]),
          rules: rules([decl({ name: 'y', value: any('1') })])
        })
      ]);
      const r1 = tree.value[0]! as Ruleset;
      const r2 = tree.value[1]! as Ruleset;
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling rulesets: compound selector', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.foo'), interpolatedSelector(interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] }))])]),
          rules: rules([decl({ name: 'y', value: any('1') })])
        }),
        ruleset({
          selector: sellist([sel([el('.bar.baz')])]),
          rules: rules([decl({ name: 'y', value: any('1') })])
        })
      ]);
      const r1 = tree.value[0]! as Ruleset;
      const r2 = tree.value[1]! as Ruleset;
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling rulesets: complex selector', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.x '), interpolatedSelector(interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })), el(' .y')])]),
          rules: rules([decl({ name: 'z', value: any('1') })])
        }),
        ruleset({
          selector: sellist([sel([el('.x .c .y')])]),
          rules: rules([decl({ name: 'z', value: any('1') })])
        })
      ]);
      const r1 = tree.value[0]! as Ruleset;
      const r2 = tree.value[1]! as Ruleset;
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling rulesets: selector list', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a, '), interpolatedSelector(interpolated({ source: '.{}', replacements: [DEFAULT_VARIABLE] }))])]),
          rules: rules([decl({ name: 'y', value: any('1') })])
        }),
        ruleset({
          selector: sellist([sel([el('.a, .c')])]),
          rules: rules([decl({ name: 'y', value: any('1') })])
        })
      ]);
      const r1 = tree.value[0]! as Ruleset;
      const r2 = tree.value[1]! as Ruleset;
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });
  });

  describe('Mixed content isolation', () => {
    test('static sibling rules maintain clean state when one has dynamic content', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.container')])]),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.static-rule')])]),
              rules: rules([decl({ name: 'color', value: any('red') })])
            }),
            ruleset({
              selector: sellist([sel([el('.dynamic-rule')])]),
              rules: rules([decl({ name: 'color', value: DEFAULT_VARIABLE })])
            })
          ])
        })
      ]);

      const container = tree.value[0]! as Ruleset;
      const staticRule = container.rules.value[0]! as Ruleset;
      const dynamicRule = container.rules.value[1]! as Ruleset;

      // Container should have mayAsync (from dynamic child)
      expectFlags(container, false, true);

      // Static rule should remain static
      expectFlags(staticRule, true, false);

      // Dynamic rule should have mayAsync
      expectFlags(dynamicRule, false, true);
    });

    test('static declarations in same ruleset maintain clean state when one has dynamic content', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.container')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') }),
            decl({ name: 'background', value: DEFAULT_VARIABLE }),
            decl({ name: 'border', value: any('1px solid black') })
          ])
        })
      ]);

      const container = tree.value[0]! as Ruleset;
      const staticDecl1 = container.rules.value[0]! as Declaration;
      const dynamicDecl = container.rules.value[1]! as Declaration;
      const staticDecl2 = container.rules.value[2]! as Declaration;

      // Container should have mayAsync (from dynamic child)
      expectFlags(container, false, true);

      // Static declarations should remain static
      expectFlags(staticDecl1, true, false);
      expectFlags(staticDecl2, true, false);

      // Dynamic declaration should have mayAsync
      expectFlags(dynamicDecl, false, true);
    });
  });

  describe('Complex nested scenarios', () => {
    test('deep nesting with mixed content', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') }),
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: rules([
                decl({ name: 'background', value: DEFAULT_VARIABLE }),
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: rules([
                    decl({ name: 'border', value: any('1px solid') }),
                    decl({ name: 'width', value: op([num(10), '+', num(5)]) })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      const level1 = tree.value[0]! as Ruleset;
      const level2 = level1.rules.value[1]! as Ruleset;
      const level3 = level2.rules.value[1]! as Ruleset;

      // Level 1 should have mayAsync (from nested dynamic content)
      expectFlags(level1, false, true);

      // Level 2 should have mayAsync (from variable and nested operation)
      expectFlags(level2, false, true);

      // Level 3 should have non-static (from operation)
      expectFlags(level3, false, false);
    });
  });
});
