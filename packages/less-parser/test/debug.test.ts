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
});
