import { expectFlags, DEFAULT_VARIABLE } from './helpers.js';
import {
  N,
  any,
  atrule,
  call,
  decl,
  el,
  interpolated,
  interpolatedSelector,
  isNode,
  list,
  negative,
  num,
  op,
  paren,
  ref,
  rules,
  ruleset,
  sel,
  sellist,
  type Declaration,
  type Ruleset
} from '../src/index.js';

function expectRulesetNode(node: unknown): Ruleset {
  expect(isNode(node, N.Ruleset)).toBe(true);
  if (!isNode(node, N.Ruleset)) {
    throw new Error('Expected Ruleset node.');
  }
  return node;
}

function expectDeclarationNode(node: unknown): Declaration {
  expect(isNode(node, N.Declaration)).toBe(true);
  if (!isNode(node, N.Declaration)) {
    throw new Error('Expected Declaration node.');
  }
  return node;
}

describe('Flag isolation', () => {
  describe('MayAsync isolation (siblings do not bleed)', () => {
    test('sibling rulesets', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [decl({ name: 'color', value: DEFAULT_VARIABLE })]
        }),
        ruleset({
          selector: sellist([sel([el('.b')])]),
          rules: [decl({ name: 'color', value: any('red') })]
        })
      ]);
      const r1 = expectRulesetNode(tree.rules[0]);
      const r2 = expectRulesetNode(tree.rules[1]);
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling at-rules', () => {
      const tree = rules([
        atrule({
          name: 'media',
          prelude: any('(min-width: 10px)'),
          rules: [decl({ name: 'color', value: DEFAULT_VARIABLE })]
        }),
        atrule({
          name: 'media',
          prelude: any('(min-width: 10px)'),
          rules: [decl({ name: 'color', value: any('red') })]
        })
      ]);
      const a1 = tree.rules[0]!;
      const a2 = tree.rules[1]!;
      expectFlags(a1, false, true); // mayAsync
      expectFlags(a2, true, false); // static
    });

    test('sibling declarations: Paren', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'p1', value: paren(ref('@v', { type: 'variable' })) }),
            decl({ name: 'p2', value: paren(any('1')) })
          ]
        })
      ]);
      const rs = expectRulesetNode(tree.rules[0]);
      const inner = rs.rules;
      const d1 = expectDeclarationNode(inner[0]);
      const d2 = expectDeclarationNode(inner[1]);
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, true, false); // static
    });

    test('sibling declarations: Block', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'b1', value: list([ref('@v', { type: 'variable' })]) }),
            decl({ name: 'b2', value: list([any('1')]) })
          ]
        })
      ]);
      const rs = expectRulesetNode(tree.rules[0]);
      const inner = rs.rules;
      const d1 = expectDeclarationNode(inner[0]);
      const d2 = expectDeclarationNode(inner[1]);
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, true, false); // static
    });

    test('sibling declarations: Operation', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'o1', value: op([num(1), '+', ref('@v', { type: 'variable' })]) }),
            decl({ name: 'o2', value: op([num(1), '+', num(2)]) })
          ]
        })
      ]);
      const rs = expectRulesetNode(tree.rules[0]);
      const inner = rs.rules;
      const d1 = expectDeclarationNode(inner[0]);
      const d2 = expectDeclarationNode(inner[1]);
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, false, false); // non-static but not mayAsync
    });

    test('sibling declarations: Negative', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'n1', value: negative(ref('@v', { type: 'variable' })) }),
            decl({ name: 'n2', value: negative(any('1')) })
          ]
        })
      ]);
      const rs = expectRulesetNode(tree.rules[0]);
      const inner = rs.rules;
      const d1 = expectDeclarationNode(inner[0]);
      const d2 = expectDeclarationNode(inner[1]);
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, false, false); // non-static but not mayAsync
    });

    test('sibling declarations: Call', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'c1', value: call({ name: 'rgb', args: list([ref('@v', { type: 'variable' }), any('1'), any('1')]) }) }),
            decl({ name: 'c2', value: call({ name: 'rgb', args: list([any('1'), any('1'), any('1')]) }) })
          ]
        })
      ]);
      const rs = expectRulesetNode(tree.rules[0]);
      const inner = rs.rules;
      const d1 = expectDeclarationNode(inner[0]);
      const d2 = expectDeclarationNode(inner[1]);
      expectFlags(d1, false, true); // mayAsync
      expectFlags(d2, false, true); // mayAsync (function calls are always mayAsync)
    });

    test('sibling rulesets: pseudo selector with selector-child', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a:has('), interpolatedSelector(interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })), el(')')])]),
          rules: [decl({ name: 'y', value: any('1') })]
        }),
        ruleset({
          selector: sellist([sel([el('.b:has(.c')])]),
          rules: [decl({ name: 'y', value: any('1') })]
        })
      ]);
      const r1 = expectRulesetNode(tree.rules[0]);
      const r2 = expectRulesetNode(tree.rules[1]);
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling rulesets: compound selector', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.foo'), interpolatedSelector(interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] }))])]),
          rules: [decl({ name: 'y', value: any('1') })]
        }),
        ruleset({
          selector: sellist([sel([el('.bar.baz')])]),
          rules: [decl({ name: 'y', value: any('1') })]
        })
      ]);
      const r1 = expectRulesetNode(tree.rules[0]);
      const r2 = expectRulesetNode(tree.rules[1]);
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling rulesets: complex selector', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.x '), interpolatedSelector(interpolated({ source: '.\u0000\u0001', replacements: [DEFAULT_VARIABLE] })), el(' .y')])]),
          rules: [decl({ name: 'z', value: any('1') })]
        }),
        ruleset({
          selector: sellist([sel([el('.x .c .y')])]),
          rules: [decl({ name: 'z', value: any('1') })]
        })
      ]);
      const r1 = expectRulesetNode(tree.rules[0]);
      const r2 = expectRulesetNode(tree.rules[1]);
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });

    test('sibling rulesets: selector list', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a, '), interpolatedSelector(interpolated({ source: '.{}', replacements: [DEFAULT_VARIABLE] }))])]),
          rules: [decl({ name: 'y', value: any('1') })]
        }),
        ruleset({
          selector: sellist([sel([el('.a, .c')])]),
          rules: [decl({ name: 'y', value: any('1') })]
        })
      ]);
      const r1 = expectRulesetNode(tree.rules[0]);
      const r2 = expectRulesetNode(tree.rules[1]);
      expectFlags(r1, false, true); // mayAsync
      expectFlags(r2, true, false); // static
    });
  });

  describe('Mixed content isolation', () => {
    test('static sibling rules maintain clean state when one has dynamic content', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.container')])]),
          rules: [
            ruleset({
              selector: sellist([sel([el('.static-rule')])]),
              rules: [decl({ name: 'color', value: any('red') })]
            }),
            ruleset({
              selector: sellist([sel([el('.dynamic-rule')])]),
              rules: [decl({ name: 'color', value: DEFAULT_VARIABLE })]
            })
          ]
        })
      ]);

      const container = expectRulesetNode(tree.rules[0]);
      const staticRule = expectRulesetNode(container.rules[0]);
      const dynamicRule = expectRulesetNode(container.rules[1]);

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
          rules: [
            decl({ name: 'color', value: any('red') }),
            decl({ name: 'background', value: DEFAULT_VARIABLE }),
            decl({ name: 'border', value: any('1px solid black') })
          ]
        })
      ]);

      const container = expectRulesetNode(tree.rules[0]);
      const staticDecl1 = expectDeclarationNode(container.rules[0]);
      const dynamicDecl = expectDeclarationNode(container.rules[1]);
      const staticDecl2 = expectDeclarationNode(container.rules[2]);

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
          rules: [
            decl({ name: 'color', value: any('red') }),
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: [
                decl({ name: 'background', value: DEFAULT_VARIABLE }),
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: [
                    decl({ name: 'border', value: any('1px solid') }),
                    decl({ name: 'width', value: op([num(10), '+', num(5)]) })
                  ]
                })
              ]
            })
          ]
        })
      ]);

      const level1 = expectRulesetNode(tree.rules[0]);
      const level2 = expectRulesetNode(level1.rules[1]);
      const level3 = expectRulesetNode(level2.rules[1]);

      // Level 1 should have mayAsync (from nested dynamic content)
      expectFlags(level1, false, true);

      // Level 2 should have mayAsync (from variable and nested operation)
      expectFlags(level2, false, true);

      // Level 3 should have non-static (from operation)
      expectFlags(level3, false, false);
    });
  });
});
