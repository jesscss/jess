import { expectFlags, DEFAULT_VARIABLE } from './helpers.js';
import {
  N,
  any,
  call,
  decl,
  el,
  isNode,
  list,
  num,
  op,
  ref,
  rules,
  ruleset,
  sel,
  sellist,
  type Call,
  type Declaration,
  type List,
  type Operation,
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

function expectListNode(node: unknown): List {
  expect(isNode(node, N.List)).toBe(true);
  if (!isNode(node, N.List)) {
    throw new Error('Expected List node.');
  }
  return node;
}

function expectOperationNode(node: unknown): Operation {
  expect(isNode(node, N.Operation)).toBe(true);
  if (!isNode(node, N.Operation)) {
    throw new Error('Expected Operation node.');
  }
  return node;
}

function expectCallNode(node: unknown): Call {
  expect(isNode(node, N.Call)).toBe(true);
  if (!isNode(node, N.Call)) {
    throw new Error('Expected Call node.');
  }
  return node;
}

describe('Flag bubbling', () => {
  describe('Static flag bubbling', () => {
    test('static content bubbles up through containers', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'color', value: any('red') }),
            decl({ name: 'background', value: any('blue') })
          ]
        })
      ]);

      const rulesetNode = expectRulesetNode(tree.rules[0]);
      expectFlags(rulesetNode, true, false); // F_STATIC, not F_MAY_ASYNC
    });

    test('non-static content bubbles up through containers', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'color', value: DEFAULT_VARIABLE }),
            decl({ name: 'background', value: any('blue') })
          ]
        })
      ]);

      const rulesetNode = expectRulesetNode(tree.rules[0]);
      expectFlags(rulesetNode, false, true); // not F_STATIC, F_MAY_ASYNC
    });

    test('mixed content bubbles up appropriate flags', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'color', value: any('red') }),
            decl({ name: 'background', value: DEFAULT_VARIABLE }),
            decl({ name: 'width', value: op([num(10), '+', num(5)]) })
          ]
        })
      ]);

      const rulesetNode = expectRulesetNode(tree.rules[0]);
      expectFlags(rulesetNode, false, true); // not F_STATIC, F_MAY_ASYNC (due to variable)
    });
  });

  describe('MayAsync flag bubbling', () => {
    test('mayAsync bubbles up through containers', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'color', value: DEFAULT_VARIABLE })
          ]
        })
      ]);

      const rulesetNode = expectRulesetNode(tree.rules[0]);
      expectFlags(rulesetNode, false, true); // F_MAY_ASYNC
    });

    test('mayAsync bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: [decl({ name: 'color', value: DEFAULT_VARIABLE })]
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: [
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: [
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: [innerRuleset]
                })
              ]
            })
          ]
        })
      ]);

      // All levels should bubble up mayAsync
      expectFlags(tree, false, true);
      const level1 = expectRulesetNode(tree.rules[0]);
      const level2 = expectRulesetNode(level1.value.rules[0]);
      const level3 = expectRulesetNode(level2.value.rules[0]);
      expectFlags(level1, false, true);
      expectFlags(level2, false, true);
      expectFlags(level3, false, true);
      expectFlags(innerRuleset, false, true);
    });

    test('function calls bubble mayAsync', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: [
            decl({ name: 'color', value: call({ name: 'rgb', args: list([num(255), num(0), num(0)]) }) })
          ]
        })
      ]);

      const rulesetNode = expectRulesetNode(tree.rules[0]);
      expectFlags(rulesetNode, false, true); // F_MAY_ASYNC
    });
  });

  describe('Comprehensive bubbling scenarios', () => {
    test('variable reference bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: [decl({ name: 'color', value: list([any('red'), DEFAULT_VARIABLE, any('blue')]) })]
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: [
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: [
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: [innerRuleset]
                })
              ]
            })
          ]
        })
      ]);

      // All levels should bubble up mayAsync
      expectFlags(tree, false, true);
      const level1 = expectRulesetNode(tree.rules[0]);
      const level2 = expectRulesetNode(level1.value.rules[0]);
      const level3 = expectRulesetNode(level2.value.rules[0]);
      expectFlags(level1, false, true);
      expectFlags(level2, false, true);
      expectFlags(level3, false, true);
      expectFlags(innerRuleset, false, true);

      // Get the deepest nodes to verify specific types
      const declaration = expectDeclarationNode(innerRuleset.value.rules[0]);
      const listNode = expectListNode(declaration.value);

      // List should have both flags (non-static + mayAsync)
      expectFlags(listNode, false, true);
    });

    test('operation bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: [decl({ name: 'width', value: op([num(10), '+', num(5)]) })]
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: [
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: [
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: [innerRuleset]
                })
              ]
            })
          ]
        })
      ]);

      // All levels should bubble up non-static
      expectFlags(tree, false, false);
      const level1 = expectRulesetNode(tree.rules[0]);
      const level2 = expectRulesetNode(level1.value.rules[0]);
      const level3 = expectRulesetNode(level2.value.rules[0]);
      expectFlags(level1, false, false);
      expectFlags(level2, false, false);
      expectFlags(level3, false, false);
      expectFlags(innerRuleset, false, false);

      // Get the deepest nodes to verify specific types
      const declaration = expectDeclarationNode(innerRuleset.value.rules[0]);
      const operation = expectOperationNode(declaration.value);

      // Operation should have non-static
      expectFlags(operation, false, false);
    });

    test('function call bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: [decl({ name: 'color', value: call({ name: 'rgb', args: list([num(255), num(0), num(0)]) }) })]
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: [
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: [
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: [innerRuleset]
                })
              ]
            })
          ]
        })
      ]);

      // All levels should bubble up non-static and mayAsync
      expectFlags(tree, false, true);
      const level1 = expectRulesetNode(tree.rules[0]);
      const level2 = expectRulesetNode(level1.value.rules[0]);
      const level3 = expectRulesetNode(level2.value.rules[0]);
      expectFlags(level1, false, true);
      expectFlags(level2, false, true);
      expectFlags(level3, false, true);
      expectFlags(innerRuleset, false, true);

      // Get the deepest nodes to verify specific types
      const declaration = expectDeclarationNode(innerRuleset.value.rules[0]);
      const callNode = expectCallNode(declaration.value);

      // Call should have both flags
      expectFlags(callNode, false, true);
    });

    test('static content maintains clean state through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: [
          decl({ name: 'color', value: any('red') }),
          decl({ name: 'background', value: any('blue') })
        ]
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: [
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: [
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: [innerRuleset]
                })
              ]
            })
          ]
        })
      ]);

      // All levels should remain static
      expectFlags(tree, true, false);
      const level1 = expectRulesetNode(tree.rules[0]);
      const level2 = expectRulesetNode(level1.value.rules[0]);
      const level3 = expectRulesetNode(level2.value.rules[0]);
      expectFlags(level1, true, false);
      expectFlags(level2, true, false);
      expectFlags(level3, true, false);
      expectFlags(innerRuleset, true, false);

      // Get the deepest nodes to verify specific types
      const declaration1 = expectDeclarationNode(innerRuleset.value.rules[0]);
      const declaration2 = expectDeclarationNode(innerRuleset.value.rules[1]);

      // Declarations should be static
      expectFlags(declaration1, true, false);
      expectFlags(declaration2, true, false);
    });
  });
});
