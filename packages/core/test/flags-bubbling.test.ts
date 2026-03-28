import { expectFlags, DEFAULT_VARIABLE } from './helpers.js';
import { rules, ruleset, sellist, sel, el, decl, any, list, num, op, call, ref, type Ruleset, type Declaration, type List, type Call, type Operation } from '../src/index.js';

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

describe('Flag bubbling', () => {
  describe('Static flag bubbling', () => {
    test('static content bubbles up through containers', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const rulesetNode = tree.value[0]! as Ruleset;
      expectFlags(rulesetNode, true, false); // F_STATIC, not F_MAY_ASYNC
    });

    test('non-static content bubbles up through containers', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'color', value: DEFAULT_VARIABLE }),
            decl({ name: 'background', value: any('blue') })
          ])
        })
      ]);

      const rulesetNode = tree.value[0]! as Ruleset;
      expectFlags(rulesetNode, false, true); // not F_STATIC, F_MAY_ASYNC
    });

    test('mixed content bubbles up appropriate flags', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'color', value: any('red') }),
            decl({ name: 'background', value: DEFAULT_VARIABLE }),
            decl({ name: 'width', value: op([num(10), '+', num(5)]) })
          ])
        })
      ]);

      const rulesetNode = tree.value[0]! as Ruleset;
      expectFlags(rulesetNode, false, true); // not F_STATIC, F_MAY_ASYNC (due to variable)
    });
  });

  describe('MayAsync flag bubbling', () => {
    test('mayAsync bubbles up through containers', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'color', value: DEFAULT_VARIABLE })
          ])
        })
      ]);

      const rulesetNode = tree.value[0]! as Ruleset;
      expectFlags(rulesetNode, false, true); // F_MAY_ASYNC
    });

    test('mayAsync bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([decl({ name: 'color', value: DEFAULT_VARIABLE })])
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: rules([
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: rules([innerRuleset])
                })
              ])
            })
          ])
        })
      ]);

      // All levels should bubble up mayAsync
      expectFlags(tree, false, true);
      expectFlags(tree.value[0]! as Ruleset, false, true);
      expectFlags((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, true);
      expectFlags(((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, true);
      expectFlags(innerRuleset, false, true);
    });

    test('function calls bubble mayAsync', () => {
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.a')])]),
          rules: rules([
            decl({ name: 'color', value: call({ name: 'rgb', args: list([num(255), num(0), num(0)]) }) })
          ])
        })
      ]);

      const rulesetNode = tree.value[0]! as Ruleset;
      expectFlags(rulesetNode, false, true); // F_MAY_ASYNC
    });
  });

  describe('Comprehensive bubbling scenarios', () => {
    test('variable reference bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([decl({ name: 'color', value: list([any('red'), DEFAULT_VARIABLE, any('blue')]) })])
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: rules([
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: rules([innerRuleset])
                })
              ])
            })
          ])
        })
      ]);

      // All levels should bubble up mayAsync
      expectFlags(tree, false, true);
      expectFlags(tree.value[0]! as Ruleset, false, true);
      expectFlags((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, true);
      expectFlags(((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, true);
      expectFlags(innerRuleset, false, true);

      // Get the deepest nodes to verify specific types
      const declaration = innerRuleset.get('rules').value[0]! as Declaration;
      const listNode = declaration.get('value') as List;

      // List should have both flags (non-static + mayAsync)
      expectFlags(listNode, false, true);
    });

    test('operation bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([decl({ name: 'width', value: op([num(10), '+', num(5)]) })])
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: rules([
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: rules([innerRuleset])
                })
              ])
            })
          ])
        })
      ]);

      // All levels should bubble up non-static
      expectFlags(tree, false, false);
      expectFlags(tree.value[0]! as Ruleset, false, false);
      expectFlags((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, false);
      expectFlags(((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, false);
      expectFlags(innerRuleset, false, false);

      // Get the deepest nodes to verify specific types
      const declaration = innerRuleset.get('rules').value[0]! as Declaration;
      const operation = declaration.get('value') as Operation;

      // Operation should have non-static
      expectFlags(operation, false, false);
    });

    test('function call bubbles through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([decl({ name: 'color', value: call({ name: 'rgb', args: list([num(255), num(0), num(0)]) }) })])
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: rules([
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: rules([innerRuleset])
                })
              ])
            })
          ])
        })
      ]);

      // All levels should bubble up non-static and mayAsync
      expectFlags(tree, false, true);
      expectFlags(tree.value[0]! as Ruleset, false, true);
      expectFlags((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, true);
      expectFlags(((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset).get('rules').value[0]! as Ruleset, false, true);
      expectFlags(innerRuleset, false, true);

      // Get the deepest nodes to verify specific types
      const declaration = innerRuleset.get('rules').value[0]! as Declaration;
      const callNode = declaration.get('value') as Call;

      // Call should have both flags
      expectFlags(callNode, false, true);
    });

    test('static content maintains clean state through multiple levels', () => {
      const innerRuleset = ruleset({
        selector: sellist([sel([el('.inner')])]),
        rules: rules([
          decl({ name: 'color', value: any('red') }),
          decl({ name: 'background', value: any('blue') })
        ])
      });
      const tree = rules([
        ruleset({
          selector: sellist([sel([el('.level1')])]),
          rules: rules([
            ruleset({
              selector: sellist([sel([el('.level2')])]),
              rules: rules([
                ruleset({
                  selector: sellist([sel([el('.level3')])]),
                  rules: rules([innerRuleset])
                })
              ])
            })
          ])
        })
      ]);

      // All levels should remain static
      expectFlags(tree, true, false);
      expectFlags(tree.value[0]! as Ruleset, true, false);
      expectFlags((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset, true, false);
      expectFlags(((tree.value[0]! as Ruleset).get('rules').value[0]! as Ruleset).get('rules').value[0]! as Ruleset, true, false);
      expectFlags(innerRuleset, true, false);

      // Get the deepest nodes to verify specific types
      const declaration1 = innerRuleset.get('rules').value[0]! as Declaration;
      const declaration2 = innerRuleset.get('rules').value[1]! as Declaration;

      // Declarations should be static
      expectFlags(declaration1, true, false);
      expectFlags(declaration2, true, false);
    });
  });
});
