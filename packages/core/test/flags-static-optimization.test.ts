import { expectFlags, DEFAULT_VARIABLE } from './helpers.js';
import { rules, ruleset, sellist, sel, el, decl, any, list, num, op, call, ref, type Ruleset, type Declaration, type List, type Call, type Operation } from '../src/index.js';

// Helper function to find a node by type using childKeys for safe traversal
function findNodeByType(node: any, type: string): any {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (node.type === type) {
    return node;
  }
  const childKeys: string[] | null = node.constructor?.childKeys ?? null;
  if (childKeys === null) {
    return null;
  }
  for (const key of childKeys) {
    const field = node[key];
    if (Array.isArray(field)) {
      for (const child of field) {
        const found = findNodeByType(child, type);
        if (found) {
          return found;
        }
      }
    } else if (field && typeof field === 'object' && 'type' in field) {
      const found = findNodeByType(field, type);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

describe('Static optimization', () => {
  test('static declarations have static flags', () => {
    // Create a static ruleset
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') }),
          decl({ name: 'width', value: any('10px') })
        ])
      })
    ]);

    // Get the first ruleset
    const rulesetNode = tree.value[0]! as Ruleset;
    expect(rulesetNode).toBeDefined();

    // Get the first declaration (color: red)
    const declaration = rulesetNode.rules.value[0]! as Declaration;
    expect(declaration).toBeDefined();
    expect(declaration.type).toBe('Declaration');

    // Verify that the declaration has static flags
    expectFlags(declaration, true, false); // F_STATIC, not F_MAY_ASYNC
  });

  test('dynamic declarations have non-static flags', () => {
    // Create a ruleset with a variable reference
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: 'color', value: DEFAULT_VARIABLE }),
          decl({ name: 'width', value: any('10px') })
        ])
      })
    ]);

    // Get the first ruleset
    const rulesetNode = tree.value[0]! as Ruleset;
    expect(rulesetNode).toBeDefined();

    // Get the first declaration (color: @var)
    const declaration = rulesetNode.rules.value[0]! as Declaration;
    expect(declaration).toBeDefined();
    expect(declaration.type).toBe('Declaration');

    // Verify that the declaration has mayAsync flags
    expectFlags(declaration, false, true); // not F_STATIC, F_MAY_ASYNC
  });

  test('operations always have non-static flags', () => {
    // Create a ruleset with a static operation
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: 'width', value: op([num(1), '+', num(2)]) })
        ])
      })
    ]);

    // Get the first ruleset
    const rulesetNode = tree.value[0]! as Ruleset;
    expect(rulesetNode).toBeDefined();

    // Get the declaration with the operation
    const declaration = rulesetNode.rules.value[0]! as Declaration;
    const operation = findNodeByType(declaration, 'Operation');
    expect(operation).toBeDefined();
    expect(operation!.type).toBe('Operation');

    // Verify that the operation has non-static flags
    expectFlags(operation!, false, false); // not F_STATIC, not F_MAY_ASYNC (static operation)
  });

  test('function calls always have non-static flags', () => {
    // Create a ruleset with a static function call
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: 'color', value: call({ name: 'rgb', args: list([num(255), num(0), num(0)]) }) })
        ])
      })
    ]);

    // Get the first ruleset
    const rulesetNode = tree.value[0]! as Ruleset;
    expect(rulesetNode).toBeDefined();

    // Get the declaration with the function call
    const declaration = rulesetNode.rules.value[0]! as Declaration;
    const callNode = findNodeByType(declaration, 'Call');
    expect(callNode).toBeDefined();
    expect(callNode!.type).toBe('Call');

    // Verify that the function call has non-static and mayAsync flags
    expectFlags(callNode!, false, true); // not F_STATIC, F_MAY_ASYNC (function calls are potentially async)
  });

  test('static container nodes have static flags', () => {
    // Create a ruleset with static container nodes
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: 'shadow', value: list([any('1px'), any('2px')]) }),
          decl({ name: 'border', value: any('1px solid red') })
        ])
      })
    ]);

    // Get the first ruleset
    const rulesetNode = tree.value[0]! as Ruleset;
    expect(rulesetNode).toBeDefined();

    const declarations = rulesetNode.rules.value;

    // Get the List node (shadow: 1px, 2px)
    const listDeclaration = declarations[0]! as Declaration;
    const listNode = findNodeByType(listDeclaration, 'List');
    expect(listNode).toBeDefined();
    expect(listNode!.type).toBe('List');

    // Verify that the list has static flags
    expectFlags(listNode!, true, false); // F_STATIC, not F_MAY_ASYNC
  });

  test('dynamic container nodes have non-static flags', () => {
    // Create a ruleset with dynamic container nodes
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: 'shadow', value: list([any('1px'), DEFAULT_VARIABLE, any('3px')]) }),
          decl({ name: 'border', value: any('1px solid red') })
        ])
      })
    ]);

    // Get the first ruleset
    const rulesetNode = tree.value[0]! as Ruleset;
    expect(rulesetNode).toBeDefined();

    const declarations = rulesetNode.rules.value;

    // Get the List node (shadow: 1px, @var, 3px)
    const listDeclaration = declarations[0]! as Declaration;
    const listNode = findNodeByType(listDeclaration, 'List');
    expect(listNode).toBeDefined();
    expect(listNode!.type).toBe('List');

    // Verify that the list has mayAsync flags
    expectFlags(listNode!, false, true); // not F_STATIC, F_MAY_ASYNC
  });

  test('mixed content rulesets have appropriate flags', () => {
    // Create a ruleset with mixed static and dynamic content
    const tree = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') }),
          decl({ name: 'background', value: DEFAULT_VARIABLE }),
          decl({ name: 'width', value: op([num(10), '+', num(5)]) }),
          decl({ name: 'border', value: any('1px solid') })
        ])
      })
    ]);

    // Get the first ruleset
    const rulesetNode = tree.value[0]! as Ruleset;
    expect(rulesetNode).toBeDefined();

    // The ruleset should have mayAsync flags due to dynamic content
    expectFlags(rulesetNode, false, true); // not F_STATIC, F_MAY_ASYNC

    const declarations = rulesetNode.rules.value;

    // Static declarations should remain static
    expectFlags(declarations[0]!, true, false); // color: red
    expectFlags(declarations[3]!, true, false); // border: 1px solid

    // Dynamic declarations should have appropriate flags
    expectFlags(declarations[1]!, false, true);  // background: @var
    expectFlags(declarations[2]!, false, false); // width: 10 + 5 (non-static but not mayAsync)
  });
});
