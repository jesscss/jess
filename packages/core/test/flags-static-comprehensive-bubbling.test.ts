import { expectFlags, DEFAULT_VARIABLE } from './helpers';
import { rules, ruleset, sellist, sel, el, decl, any, list, num, Operation, call, ref } from '../src';

// Helper function to find a node by type
function findNodeByType(node: any, type: string): any {
  if (node.type === type) {
    return node;
  }

  if (node.value) {
    if (Array.isArray(node.value)) {
      for (const child of node.value) {
        const found = findNodeByType(child, type);
        if (found) {
          return found;
        }
      }
    } else if (typeof node.value === 'object') {
      const found = findNodeByType(node.value, type);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

// Helper function to verify flag bubbling through nested levels
const verifyNestedBubbling = (
  tree: any,
  expectedNonStatic: boolean,
  expectedMayAsync: boolean,
  levels = 4
) => {
  // Root should have expected flags
  expectFlags(tree, !expectedNonStatic, expectedMayAsync);

  // Each nested level should bubble up the same flags
  let current = tree.value[0]!;
  for (let i = 0; i < levels; i++) {
    expectFlags(current, !expectedNonStatic, expectedMayAsync);
    current = current.value.rules.value[0]!;
  }
};

// Helper function to verify individual node flags
const verifyNodeFlags = (node: any, nonStatic: boolean, mayAsync: boolean) => {
  expectFlags(node, !nonStatic, mayAsync);
};

// Helper to create nested rulesets
const createNestedRulesets = (innerContent: any, levels = 4) => {
  let current = innerContent;
  for (let i = 0; i < levels; i++) {
    current = ruleset({
      selector: sellist([sel([el(`.level${i + 1}`)])]),
      rules: rules([current])
    });
  }
  return rules([current]);
};

describe('Comprehensive flag bubbling and isolation', () => {
  describe('Dynamic content bubbling', () => {
    test('variable reference bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([decl({ name: 'color', value: list([any('red'), DEFAULT_VARIABLE, any('blue')]) })])
      });
      const tree = createNestedRulesets(innerRuleset);

      // All levels should bubble up mayAsync
      verifyNestedBubbling(tree, true, true);

      // Get the deepest nodes to verify specific types
      const innerRulesetNode = tree.value[0]!.value.rules.value[0]!.value.rules.value[0]!.value.rules.value[0]! as any;
      const declaration = innerRulesetNode.value.rules.value[0]! as any;
      const listNode = declaration.value.value as any;

      // List should have both flags (non-static + mayAsync)
      verifyNodeFlags(listNode, true, true);
    });

    test('operation bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([decl({ name: 'width', value: new Operation([num(10), '+', num(5)]) })])
      });
      const tree = createNestedRulesets(innerRuleset);

      // All levels should bubble up non-static
      verifyNestedBubbling(tree, true, false);

      // Get the deepest nodes to verify specific types
      const innerRulesetNode = tree.value[0]!.value.rules.value[0]!.value.rules.value[0]!.value.rules.value[0]! as any;
      const declaration = innerRulesetNode.value.rules.value[0]! as any;
      const operation = declaration.value.value as any;

      // Operation should have non-static
      verifyNodeFlags(operation, true, false);
    });

    test('function call bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([decl({ name: 'color', value: call({ name: 'rgb', args: list([num(255), num(0), num(0)]) }) })])
      });
      const tree = createNestedRulesets(innerRuleset);

      // All levels should bubble up non-static and mayAsync
      verifyNestedBubbling(tree, true, true);

      // Get the deepest nodes to verify specific types
      const innerRulesetNode = tree.value[0]!.value.rules.value[0]!.value.rules.value[0]!.value.rules.value[0]!;
      const declaration = innerRulesetNode.value.rules.value[0]!;
      const callNode = declaration.value.value;

      // Call should have both flags
      verifyNodeFlags(callNode, true, true);
    });
  });

  describe('Static content isolation', () => {
    test('static content maintains clean state through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') }),
          decl({ name: 'background', value: any('blue') })
        ])
      });
      const tree = createNestedRulesets(innerRuleset);

      // All levels should remain static
      verifyNestedBubbling(tree, false, false);

      // Get the deepest nodes to verify specific types
      const innerRulesetNode = tree.value[0]!.value.rules.value[0]!.value.rules.value[0]!.value.rules.value[0]!;
      const declaration1 = innerRulesetNode.value.rules.value[0]!;
      const declaration2 = innerRulesetNode.value.rules.value[1]!;

      // Declarations should be static
      verifyNodeFlags(declaration1, false, false);
      verifyNodeFlags(declaration2, false, false);
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

      const container = tree.value[0]!;
      const staticRule = container.value.rules.value[0]!;
      const dynamicRule = container.value.rules.value[1]!;

      // Container should have mayAsync (from dynamic child)
      expectFlags(container, false, true);

      // Static rule should remain static
      expectFlags(staticRule, false, false);

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

      const container = tree.value[0]!;
      const staticDecl1 = container.value.rules.value[0]!;
      const dynamicDecl = container.value.rules.value[1]!;
      const staticDecl2 = container.value.rules.value[2]!;

      // Container should have mayAsync (from dynamic child)
      expectFlags(container, false, true);

      // Static declarations should remain static
      expectFlags(staticDecl1, false, false);
      expectFlags(staticDecl2, false, false);

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
                    decl({ name: 'width', value: new Operation([num(10), '+', num(5)]) })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      const level1 = tree.value[0]!;
      const level2 = level1.value.rules.value[1]!;
      const level3 = level2.value.rules.value[1]!;

      // Level 1 should have mayAsync (from nested dynamic content)
      expectFlags(level1, false, true);

      // Level 2 should have mayAsync (from variable and nested operation)
      expectFlags(level2, false, true);

      // Level 3 should have non-static (from operation)
      expectFlags(level3, true, false);
    });
  });
});
