import { Parser } from '../src';
import { type Node, type Rules, type Ruleset, type Declaration, type Operation } from '@jesscss/core';
import { Context } from '@jesscss/core';

describe('Evaluation optimization', () => {
  const parser = new Parser();
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  test('static declarations have no evaluation flags', () => {
    // Parse a static ruleset
    const { tree } = parser.parse('.a { color: red; width: 10px; }');

    // Get the first ruleset
    const ruleset = tree.value[0]! as Ruleset;
    expect(ruleset).toBeDefined();

    // Get the first declaration (color: red)
    const declaration = ruleset.value.rules.value[0]!;
    expect(declaration).toBeDefined();
    expect(declaration.type).toBe('Declaration');

    // Verify that the declaration has no evaluation flags
    expect(declaration.getState(0b100)).toBe(false); // F_NEEDS_EVALUATION
    expect(declaration.getState(0b10)).toBe(false);  // F_MAY_ASYNC
  });

  test('dynamic declarations have evaluation flags', () => {
    // Parse a ruleset with a variable reference
    const { tree } = parser.parse('.a { color: @var; width: 10px; }');

    // Get the first ruleset
    const ruleset = tree.value[0]! as Ruleset;
    expect(ruleset).toBeDefined();

    // Get the first declaration (color: @var)
    const declaration = ruleset.value.rules.value[0]!;
    expect(declaration).toBeDefined();
    expect(declaration.type).toBe('Declaration');

    // Verify that the declaration has evaluation flags
    expect(declaration.getState(0b100)).toBe(true);  // F_NEEDS_EVALUATION
    expect(declaration.getState(0b10)).toBe(true);   // F_MAY_ASYNC
  });

  test('operations always have evaluation flags', () => {
    // Parse a ruleset with a static operation
    const { tree } = parser.parse('.a { width: 1 + 2; }');

    // Get the first ruleset
    const ruleset = tree.value[0]! as Ruleset;
    expect(ruleset).toBeDefined();

    // Get the declaration with the operation
    const declaration = ruleset.value.rules.value[0]! as Declaration;
    const operation = findNodeByType(declaration, 'Operation');
    expect(operation).toBeDefined();
    expect(operation!.type).toBe('Operation');

    // Verify that the operation has evaluation flags
    expect(operation!.getState(0b100)).toBe(true);  // F_NEEDS_EVALUATION
    expect(operation!.getState(0b10)).toBe(false);  // F_MAY_ASYNC (static operation)
  });

  test('function calls always have evaluation flags', () => {
    // Parse a ruleset with a static function call
    const { tree } = parser.parse('.a { color: rgb(255, 0, 0); }');

    // Get the first ruleset
    const ruleset = (tree as Rules).value[0]!;
    expect(ruleset).toBeDefined();

    // Get the declaration with the function call
    const declaration = (ruleset as any).value.rules.value[0]!;
    const call = findNodeByType(declaration, 'Call');
    expect(call).toBeDefined();
    expect(call!.type).toBe('Call');

    // Verify that the function call has evaluation flags
    expect(call!.getState(0b100)).toBe(true);  // F_NEEDS_EVALUATION
    expect(call!.getState(0b10)).toBe(true);   // F_MAY_ASYNC (function calls are potentially async)
  });

  test('static container nodes have no evaluation flags', () => {
    // Parse a ruleset with static container nodes
    const { tree } = parser.parse('.a { shadow: 1px, 2px; border: 1px solid red; }');

    // Get the first ruleset
    const ruleset = (tree as Rules).value[0]!;
    expect(ruleset).toBeDefined();

    const declarations = (ruleset as any).value.rules.value;

    // Get the List node (shadow: 1px, 2px)
    const listDeclaration = declarations[0]!;
    const list = findNodeByType(listDeclaration, 'List');
    expect(list).toBeDefined();
    expect(list!.type).toBe('List');

    // Get the Sequence node (border: 1px solid red)
    const sequenceDeclaration = declarations[1]!;
    const sequence = findNodeByType(sequenceDeclaration, 'Sequence');
    expect(sequence).toBeDefined();
    expect(sequence!.type).toBe('Sequence');

    // Verify that static container nodes have no evaluation flags
    expect(list!.getState(0b100)).toBe(false);     // F_NEEDS_EVALUATION
    expect(list!.getState(0b10)).toBe(false);      // F_MAY_ASYNC
    expect(sequence!.getState(0b100)).toBe(false); // F_NEEDS_EVALUATION
    expect(sequence!.getState(0b10)).toBe(false);  // F_MAY_ASYNC
  });

  test('nested static rulesets have no evaluation flags', () => {
    // Parse a ruleset with nested static rulesets
    const { tree } = parser.parse('.a { .b { color: red; } .c { width: 10px; } }');

    // Get the first ruleset
    const ruleset = (tree as Rules).value[0]!;
    expect(ruleset).toBeDefined();

    // Get the nested rulesets
    const nestedRulesets = (ruleset as any).value.rules.value;
    expect(nestedRulesets).toHaveLength(2);

    // Verify that nested static rulesets have no evaluation flags
    expect(nestedRulesets[0]!.getState(0b100)).toBe(false); // F_NEEDS_EVALUATION
    expect(nestedRulesets[0]!.getState(0b10)).toBe(false);  // F_MAY_ASYNC
    expect(nestedRulesets[1]!.getState(0b100)).toBe(false); // F_NEEDS_EVALUATION
    expect(nestedRulesets[1]!.getState(0b10)).toBe(false);  // F_MAY_ASYNC
  });

  test('at-rules with static content have no evaluation flags', () => {
    // Parse a ruleset with an at-rule containing static content
    const { tree } = parser.parse('.a { @media screen { color: red; } }');

    // Get the first ruleset
    const ruleset = (tree as Rules).value[0]!;
    expect(ruleset).toBeDefined();

    // Get the at-rule
    const atRule = (ruleset as any).value.rules.value[0]!;
    expect(atRule.type).toBe('AtRule');

    // Verify that the at-rule with static content has no evaluation flags
    expect(atRule.getState(0b100)).toBe(false); // F_NEEDS_EVALUATION
    expect(atRule.getState(0b10)).toBe(false);  // F_MAY_ASYNC
  });
});

// Helper function to find a node by type
function findNodeByType(node: any, type: string): any {
  if (node.type === type) {
    return node;
  }

  if (node.value) {
    if (Array.isArray(node.value)) {
      for (const child of node.value) {
        const found = findNodeByType(child, type);
        if (found) return found;
      }
    } else if (typeof node.value === 'object') {
      const found = findNodeByType(node.value, type);
      if (found) return found;
    }
  }

  return null;
}
