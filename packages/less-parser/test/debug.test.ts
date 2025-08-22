import { F_MAY_ASYNC, F_NEEDS_EVALUATION } from '@jesscss/core';
import { parse } from './helpers';

describe('Debug parsing', () => {
  test('simple parse', () => {
    const result = parse('.a { color: red }', 'stylesheet');
    console.log('Parse result:', result);

    if (result.tree) {
      console.log('Tree state:', result.tree.state);
      console.log('Tree getState method:', typeof result.tree.getState);
      // Test the flag constants
      console.log('Tree getState(F_MAY_ASYNC):', result.tree.getState(F_MAY_ASYNC));
      console.log('Tree getState(F_NEEDS_EVALUATION):', result.tree.getState(F_NEEDS_EVALUATION));
      console.log('Tree evaluated (inverted):', !result.tree.getState(F_NEEDS_EVALUATION));
    }

    expect(result.tree).toBeDefined();
  });

  test('variable reference debug', () => {
    const result = parse('.a { color: @var }', 'stylesheet');
    console.log('Variable reference parse result:', result);

    if (result.tree) {
      console.log('Tree state:', result.tree.state);
      console.log('Tree getState(F_MAY_ASYNC):', result.tree.getState(F_MAY_ASYNC));
      console.log('Tree getState(F_NEEDS_EVALUATION):', result.tree.getState(F_NEEDS_EVALUATION));

      // Let's look at the ruleset
      const ruleset = result.tree.at(0);
      if (ruleset) {
        console.log('Ruleset state:', ruleset.state);
        console.log('Ruleset getState(F_MAY_ASYNC):', ruleset.getState(F_MAY_ASYNC));

        // Let's look at the rules
        const rules = (ruleset as any).value.rules;
        if (rules) {
          console.log('Rules state:', rules.state);
          console.log('Rules getState(F_MAY_ASYNC):', rules.getState(F_MAY_ASYNC));

          // Let's look at the first rule (should be a declaration)
          const firstRule = rules.at(0);
          if (firstRule) {
            console.log('First rule type:', firstRule.type);
            console.log('First rule state:', firstRule.state);
            console.log('First rule getState(F_MAY_ASYNC):', firstRule.getState(F_MAY_ASYNC));

            // Let's look at the declaration value
            const value = (firstRule as any).value.value;
            if (value) {
              console.log('Declaration value type:', value.type);
              console.log('Declaration value state:', value.state);
              console.log('Declaration value getState(F_MAY_ASYNC):', value.getState(F_MAY_ASYNC));
            }
          }
        }
      }
    }

    expect(result.tree).toBeDefined();
  });

  test('operation debug', () => {
    const result = parse('.a { width: 1 + 2 }', 'stylesheet');
    console.log('Operation parse result:', result);

    if (result.tree) {
      console.log('Tree state:', result.tree.state);
      console.log('Tree getState(F_NEEDS_EVALUATION):', result.tree.getState(F_NEEDS_EVALUATION));
      console.log('Tree getState(F_MAY_ASYNC):', result.tree.getState(F_MAY_ASYNC));

      // Let's look at the ruleset
      const ruleset = result.tree.at(0);
      if (ruleset) {
        console.log('Ruleset state:', ruleset.state);
        console.log('Ruleset getState(F_NEEDS_EVALUATION):', ruleset.getState(F_NEEDS_EVALUATION));
        console.log('Ruleset getState(F_MAY_ASYNC):', ruleset.getState(F_MAY_ASYNC));

        // Let's look at the rules
        const rules = (ruleset as any).value.rules;
        if (rules) {
          console.log('Rules state:', rules.state);
          console.log('Rules getState(F_NEEDS_EVALUATION):', rules.getState(F_NEEDS_EVALUATION));
          console.log('Rules getState(F_MAY_ASYNC):', rules.getState(F_MAY_ASYNC));

          // Let's look at the first rule (should be a declaration)
          const firstRule = rules.at(0);
          if (firstRule) {
            console.log('First rule type:', firstRule.type);
            console.log('First rule state:', firstRule.state);
            console.log('First rule getState(F_NEEDS_EVALUATION):', firstRule.getState(F_NEEDS_EVALUATION));
            console.log('First rule getState(F_MAY_ASYNC):', firstRule.getState(F_MAY_ASYNC));

            // Let's look at the declaration value
            const value = (firstRule as any).value.value;
            if (value) {
              console.log('Declaration value type:', value.type);
              console.log('Declaration value state:', value.state);
              console.log('Declaration value getState(F_NEEDS_EVALUATION):', value.getState(F_NEEDS_EVALUATION));
              console.log('Declaration value getState(F_MAY_ASYNC):', value.getState(F_MAY_ASYNC));
            }
          }
        }
      }
    }

    expect(result.tree).toBeDefined();
  });

  test('negative operation debug', () => {
    const result = parse('.a { width: -10px }', 'stylesheet');
    console.log('Testing: .a { width: -10px }');
    console.log('Negative operation parse result:', result);

    if (result.tree) {
      console.log('Tree state:', result.tree.state);
      console.log('Tree getState(F_NEEDS_EVALUATION):', result.tree.getState(F_NEEDS_EVALUATION));
      console.log('Tree getState(F_MAY_ASYNC):', result.tree.getState(F_MAY_ASYNC));

      // Let's look at the ruleset
      const ruleset = result.tree.at(0);
      if (ruleset) {
        console.log('Ruleset state:', ruleset.state);
        console.log('Ruleset getState(F_NEEDS_EVALUATION):', ruleset.getState(F_NEEDS_EVALUATION));
        console.log('Ruleset getState(F_MAY_ASYNC):', ruleset.getState(F_MAY_ASYNC));

        // Let's look at the rules
        const rules = (ruleset as any).value.rules;
        if (rules) {
          console.log('Rules state:', rules.state);
          console.log('Rules getState(F_NEEDS_EVALUATION):', rules.getState(F_NEEDS_EVALUATION));
          console.log('Rules getState(F_MAY_ASYNC):', rules.getState(F_MAY_ASYNC));

          // Let's look at the first rule (should be a declaration)
          const firstRule = rules.at(0);
          if (firstRule) {
            console.log('First rule type:', firstRule.type);
            console.log('First rule state:', firstRule.state);
            console.log('First rule getState(F_NEEDS_EVALUATION):', firstRule.getState(F_NEEDS_EVALUATION));
            console.log('First rule getState(F_MAY_ASYNC):', firstRule.getState(F_MAY_ASYNC));

            // Let's look at the declaration value
            const value = (firstRule as any).value.value;
            if (value) {
              console.log('Declaration value type:', value.type);
              console.log('Declaration value state:', value.state);
              console.log('Declaration value getState(F_NEEDS_EVALUATION):', value.getState(F_NEEDS_EVALUATION));
              console.log('Declaration value getState(F_MAY_ASYNC):', value.getState(F_MAY_ASYNC));
            }
          }
        }
      }
    }

    expect(result.tree).toBeDefined();
  });

  test('negative variable debug', () => {
    const result = parse('.a { width: -@var }', 'stylesheet');
    console.log('Testing: .a { width: -@var }');
    console.log('Negative variable parse result:', result);

    if (result.tree) {
      console.log('Tree state:', result.tree.state);
      console.log('Tree getState(F_NEEDS_EVALUATION):', result.tree.getState(F_NEEDS_EVALUATION));
      console.log('Tree getState(F_MAY_ASYNC):', result.tree.getState(F_MAY_ASYNC));

      // Let's look at the ruleset
      const ruleset = result.tree.at(0);
      if (ruleset) {
        console.log('Ruleset state:', ruleset.state);
        console.log('Ruleset getState(F_NEEDS_EVALUATION):', ruleset.getState(F_NEEDS_EVALUATION));
        console.log('Ruleset getState(F_MAY_ASYNC):', ruleset.getState(F_MAY_ASYNC));

        // Let's look at the rules
        const rules = (ruleset as any).value.rules;
        if (rules) {
          console.log('Rules state:', rules.state);
          console.log('Rules getState(F_NEEDS_EVALUATION):', rules.getState(F_NEEDS_EVALUATION));
          console.log('Rules getState(F_MAY_ASYNC):', rules.getState(F_MAY_ASYNC));

          // Let's look at the first rule (should be a declaration)
          const firstRule = rules.at(0);
          if (firstRule) {
            console.log('First rule type:', firstRule.type);
            console.log('First rule state:', firstRule.state);
            console.log('First rule getState(F_NEEDS_EVALUATION):', firstRule.getState(F_NEEDS_EVALUATION));
            console.log('First rule getState(F_MAY_ASYNC):', firstRule.getState(F_MAY_ASYNC));

            // Let's look at the declaration value
            const value = (firstRule as any).value.value;
            if (value) {
              console.log('Declaration value type:', value.type);
              console.log('Declaration value state:', value.state);
              console.log('Declaration value getState(F_NEEDS_EVALUATION):', value.getState(F_NEEDS_EVALUATION));
              console.log('Declaration value getState(F_MAY_ASYNC):', value.getState(F_MAY_ASYNC));
            }
          }
        }
      }
    }

    expect(result.tree).toBeDefined();
  });

  test('at-rule debug', () => {
    const { tree } = parse('@media screen { .a { color: red } }', 'stylesheet');
    console.log('Testing: @media screen { .a { color: red } }');

    if (tree) {
      console.log('Tree state:', tree.state);
      console.log('Tree getState(F_NEEDS_EVALUATION):', tree.getState(F_NEEDS_EVALUATION));
      console.log('Tree getState(F_MAY_ASYNC):', tree.getState(F_MAY_ASYNC));

      // The tree is a Rules node containing rules
      const rules = tree;
      console.log('Rules state:', rules.state);
      console.log('Rules getState(F_NEEDS_EVALUATION):', rules.getState(F_NEEDS_EVALUATION));
      console.log('Rules getState(F_MAY_ASYNC):', rules.getState(F_MAY_ASYNC));

      // Let's look at the first rule (should be an at-rule)
      const firstRule = rules.at(0);
      if (firstRule) {
        console.log('First rule type:', firstRule.type);
        console.log('First rule state:', firstRule.state);
        console.log('First rule getState(F_NEEDS_EVALUATION):', firstRule.getState(F_NEEDS_EVALUATION));
        console.log('First rule getState(F_MAY_ASYNC):', firstRule.getState(F_MAY_ASYNC));

        // If it's an at-rule, let's look at its contents
        if (firstRule.type === 'AtRule') {
          const atRule = firstRule as any;
          console.log('AtRule name:', atRule.value.name);
          console.log('AtRule prelude state:', atRule.value.prelude?.state);
          console.log('AtRule prelude getState(F_NEEDS_EVALUATION):', atRule.value.prelude?.getState(F_NEEDS_EVALUATION));
          console.log('AtRule prelude getState(F_MAY_ASYNC):', atRule.value.prelude?.getState(F_MAY_ASYNC));

          if (atRule.value.rules) {
            console.log('AtRule rules state:', atRule.value.rules.state);
            console.log('AtRule rules getState(F_NEEDS_EVALUATION):', atRule.value.rules.getState(F_NEEDS_EVALUATION));
            console.log('AtRule rules getState(F_MAY_ASYNC):', atRule.value.rules.getState(F_MAY_ASYNC));
          }
        }
      }
    }

    expect(tree).toBeDefined();
  });

  test('flag isolation debug', () => {
    // Parse a simple static case first
    const { tree: staticTree } = parse('.a { color: red }');
    console.log('Static tree state:', staticTree.state);
    console.log('Static tree F_NEEDS_EVALUATION:', staticTree.getState(F_NEEDS_EVALUATION));
    console.log('Static tree F_MAY_ASYNC:', staticTree.getState(F_MAY_ASYNC));

    // Parse a case with variables
    const { tree: variableTree } = parse('.a { color: @var }');
    console.log('Variable tree state:', variableTree.state);
    console.log('Variable tree F_NEEDS_EVALUATION:', variableTree.getState(F_NEEDS_EVALUATION));
    console.log('Variable tree F_MAY_ASYNC:', variableTree.getState(F_MAY_ASYNC));

    // Parse static again - should still be clean
    const { tree: staticTree2 } = parse('.b { width: 10px }');
    console.log('Static tree 2 state:', staticTree2.state);
    console.log('Static tree 2 F_NEEDS_EVALUATION:', staticTree2.getState(F_NEEDS_EVALUATION));
    console.log('Static tree 2 F_MAY_ASYNC:', staticTree2.getState(F_MAY_ASYNC));

    expect(staticTree2.getState(F_NEEDS_EVALUATION)).toBe(false);
    expect(staticTree2.getState(F_MAY_ASYNC)).toBe(false);
  });

  test('variable reference debug', () => {
    const { tree } = parse('.a { color: @var }');
    console.log('Variable reference tree state:', tree.state);
    console.log('Variable reference tree F_NEEDS_EVALUATION:', tree.getState(F_NEEDS_EVALUATION));
    console.log('Variable reference tree F_MAY_ASYNC:', tree.getState(F_MAY_ASYNC));

    // Look at the first rule
    const firstRule = tree.at(0);
    if (firstRule) {
      console.log('First rule type:', firstRule.type);
      console.log('First rule state:', firstRule.state);
      console.log('First rule F_NEEDS_EVALUATION:', firstRule.getState(F_NEEDS_EVALUATION));
      console.log('First rule F_MAY_ASYNC:', firstRule.getState(F_MAY_ASYNC));

      // Look at the declaration
      const ruleset = firstRule as any;
      if (ruleset.value && ruleset.value.rules) {
        const declaration = ruleset.value.rules.at(0);
        if (declaration) {
          console.log('Declaration type:', declaration.type);
          console.log('Declaration state:', declaration.state);
          console.log('Declaration F_NEEDS_EVALUATION:', declaration.getState(F_NEEDS_EVALUATION));
          console.log('Declaration F_MAY_ASYNC:', declaration.getState(F_MAY_ASYNC));

          // Look at the value
          const decl = declaration as any;
          if (decl.value && decl.value.value) {
            console.log('Declaration value type:', decl.value.value.type);
            console.log('Declaration value state:', decl.value.value.state);
            console.log('Declaration value F_NEEDS_EVALUATION:', decl.value.value.getState(F_NEEDS_EVALUATION));
            console.log('Declaration value F_MAY_ASYNC:', decl.value.value.getState(F_MAY_ASYNC));
          }
        }
      }
    }

    expect(tree).toBeDefined();
  });
});
