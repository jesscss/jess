import { parse, expectFlags, testPatterns, getNestedNode } from './helpers';

import {
  type Ruleset,
  type Declaration,
  type List,
  type Operation
} from '@jesscss/core';

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
  expectedNeedsEvaluation: boolean,
  expectedMayAsync: boolean,
  levels = 4
) => {
  // Root should have expected flags
  expectFlags(tree, expectedNeedsEvaluation, expectedMayAsync);

  // Each nested level should bubble up the same flags
  let current = tree.value[0]!;
  for (let i = 0; i < levels; i++) {
    expectFlags(current, expectedNeedsEvaluation, expectedMayAsync);
    current = current.value.rules.value[0]!;
  }
};

// Helper function to verify individual node flags
const verifyNodeFlags = (node: any, needsEvaluation: boolean, mayAsync: boolean) => {
  expectFlags(node, needsEvaluation, mayAsync);
};

describe('Comprehensive flag bubbling and isolation', () => {
  describe('Dynamic content bubbling', () => {
    test('variable reference bubbles through multiple levels', () => {
      const { tree } = parse(testPatterns.nestedRulesets('color: [red, @var, blue];'));

      // All levels should bubble up mayAsync
      verifyNestedBubbling(tree, true, true);

      // Get the deepest nodes to verify specific types
      const innerRuleset = getNestedNode(tree, [0, 0, 0, 0]) as Ruleset;
      const declaration = innerRuleset.value.rules.value[0]! as Declaration;
      const list = declaration.value.value as List;

      // List should have both flags (needs evaluation + mayAsync)
      verifyNodeFlags(list, true, true);
    });

    test('operation bubbles through multiple levels', () => {
      const { tree } = parse(testPatterns.nestedRulesets('width: 10px + 5px;'));

      // All levels should bubble up needs evaluation
      verifyNestedBubbling(tree, true, false);

      // Get the deepest nodes to verify specific types
      const innerRuleset = getNestedNode(tree, [0, 0, 0, 0]) as Ruleset;
      const declaration = innerRuleset.value.rules.value[0]! as Declaration;
      const operation = declaration.value.value as Operation;

      // Operation should have needs evaluation
      verifyNodeFlags(operation, true, false);
    });

    test('function call bubbles through multiple levels', () => {
      const { tree } = parse(testPatterns.nestedRulesets('color: rgb(255, 0, 0);'));

      // All levels should bubble up needs evaluation and mayAsync
      verifyNestedBubbling(tree, true, true);

      // Get the deepest nodes to verify specific types
      const innerRuleset = getNestedNode(tree, [0, 0, 0, 0]) as Ruleset;
      const declaration = innerRuleset.value.rules.value[0]! as Declaration;
      const call = declaration.value.value;

      // Call should have both flags
      verifyNodeFlags(call, true, true);
    });
  });

  describe('Static content isolation', () => {
    test('static content maintains clean state through multiple levels', () => {
      const { tree } = parse(testPatterns.nestedRulesets(`
        color: red;
        background: blue;
        border: 1px solid black;
      `));

      // All levels should be clean
      verifyNestedBubbling(tree, false, false);

      // All declarations should be clean
      const innerRuleset = getNestedNode(tree, [0, 0, 0, 0]) as Ruleset;
      const declarations = innerRuleset.value.rules.value;

      for (const declaration of declarations) {
        verifyNodeFlags(declaration, false, false);
      }
    });
  });

  describe('Mixed content isolation', () => {
    test('static sibling rules maintain clean state when one has dynamic content', () => {
      const { tree } = parse(`
        .container {
          .static-rule {
            color: red;
            background: blue;
          }
          .dynamic-rule {
            color: @var;
            width: 10px + 5px;
          }
          .another-static-rule {
            border: 1px solid black;
            margin: 10px;
          }
        }
      `);

      // Root should have flags due to dynamic content
      verifyNodeFlags(tree, true, true);

      const container = tree.value[0]! as Ruleset;
      verifyNodeFlags(container, true, true);

      // Static rules should maintain clean state
      const staticRule = container.value.rules.value[0]!;
      verifyNodeFlags(staticRule, false, false);

      // Dynamic rule should have flags
      const dynamicRule = container.value.rules.value[1]!;
      verifyNodeFlags(dynamicRule, true, true);

      // Another static rule should maintain clean state
      const anotherStaticRule = container.value.rules.value[2]!;
      verifyNodeFlags(anotherStaticRule, false, false);
    });

    test('static declarations in same ruleset maintain clean state when one has dynamic content', () => {
      const { tree } = parse(`
        .container {
          color: red;
          background: @var;
          border: 1px solid black;
          width: 10px + 5px;
          margin: 10px;
        }
      `);

      const ruleset = tree.value[0]! as Ruleset;
      // Ruleset should have flags due to dynamic content
      verifyNodeFlags(ruleset, true, true);

      const declarations = ruleset.value.rules.value;

      // Static declarations should maintain clean state
      verifyNodeFlags(declarations[0]!, false, false); // color: red
      verifyNodeFlags(declarations[2]!, false, false); // border: 1px solid black
      verifyNodeFlags(declarations[4]!, false, false); // margin: 10px

      // Dynamic declarations should have appropriate flags
      verifyNodeFlags(declarations[1]!, true, true);  // background: @var
      verifyNodeFlags(declarations[3]!, true, false);  // width: 10px + 5px
    });
  });

  describe('Complex nested scenarios', () => {
    test('deep nesting with mixed content', () => {
      const { tree } = parse(`
        .level1 {
          .level2 {
            .level3 {
              .level4 {
                .level5 {
                  color: red;
                  background: @var;
                  width: 10px + 5px;
                  border: 1px solid black;
                }
              }
            }
          }
        }
      `);

      // All levels should bubble up flags
      verifyNestedBubbling(tree, true, true, 4);

      // Check individual declarations in deepest level
      const deepestRuleset = getNestedNode(tree, [0, 0, 0, 0, 0]) as Ruleset;
      const declarations = deepestRuleset.value.rules.value;

      verifyNodeFlags(declarations[0]!, false, false); // color: red
      verifyNodeFlags(declarations[1]!, true, true);  // background: @var
      verifyNodeFlags(declarations[2]!, true, false);  // width: 10px + 5px
      verifyNodeFlags(declarations[3]!, false, false); // border: 1px solid black
    });
  });
});
