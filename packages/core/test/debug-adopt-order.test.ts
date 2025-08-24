import { F_MAY_ASYNC, F_NON_STATIC, F_STATIC, F_VISIBLE } from '../src/tree/node';
import { Rules } from '../src/tree/rules';
import { Any } from '../src/tree/any';
import { Operation } from '../src/tree/operation';
import { num } from '../src/tree/number';
import { Declaration } from '../src/tree/declaration';
import { createMultipleRules, createStaticRuleset, createOperation, createVariableReference } from './helpers';
import { el, any, ruleset, sellist, sel, rules, decl } from '../src';

// Add debug logging to the adopt method
const originalAdopt = (Rules.prototype as any).adopt;
(Rules.prototype as any).adopt = function(node: any) {
  console.log(`DEBUG: Rules.adopt called with ${node.type} (state: ${node.state})`);
  console.log(`DEBUG: Rules state before adopt: ${this.state}`);
  const result = originalAdopt.call(this, node);
  console.log(`DEBUG: Rules state after adopt: ${this.state}`);
  return result;
};

describe('Debug adopt order', () => {
  test('Track flag initialization and adopt order', () => {
    console.log('\n=== Starting debug test ===');

    // Create a static node
    console.log('\n--- Creating static node ---');
    const staticNode = new Any('red');
    console.log(`Static node state: ${staticNode.state} (${staticNode.state.toString(2)})`);
    console.log(`Static node F_STATIC: ${staticNode.hasFlag(F_STATIC)}`);
    console.log(`Static node F_NON_STATIC: ${staticNode.hasFlag(F_NON_STATIC)}`);

    // Create a non-static node
    console.log('\n--- Creating non-static node ---');
    const nonStaticNode = new Operation([num(1), '+', num(2)]);
    console.log(`Non-static node state: ${nonStaticNode.state} (${nonStaticNode.state.toString(2)})`);
    console.log(`Non-static node F_STATIC: ${nonStaticNode.hasFlag(F_STATIC)}`);
    console.log(`Non-static node F_NON_STATIC: ${nonStaticNode.hasFlag(F_NON_STATIC)}`);

    // Create a container with mixed children
    console.log('\n--- Creating container with mixed children ---');
    const container = new Rules([staticNode, nonStaticNode]);
    console.log(`Container state: ${container.state} (${container.state.toString(2)})`);
    console.log(`Container F_STATIC: ${container.hasFlag(F_STATIC)}`);
    console.log(`Container F_NON_STATIC: ${container.hasFlag(F_NON_STATIC)}`);
    console.log(`Container F_MAY_ASYNC: ${container.hasFlag(F_MAY_ASYNC)}`);

    // Check if children have parents set
    console.log('\n--- Checking parent relationships ---');
    console.log(`Static node parent: ${staticNode.parent?.type}`);
    console.log(`Non-static node parent: ${nonStaticNode.parent?.type}`);

    console.log('\n=== Debug test complete ===');

    // The container should be F_NON_STATIC because it contains a non-static child
    expect(container.hasFlag(F_STATIC)).toBe(false);
    expect(container.hasFlag(F_NON_STATIC)).toBe(true);
  });

  test('Debug isolation test case', () => {
    console.log('\n=== Starting isolation debug test ===');

    // Create a declaration with an operation (like in the isolation test)
    console.log('\n--- Creating declaration with operation ---');
    const operation = new Operation([num(1), '+', num(2)]);
    console.log(`Operation state: ${operation.state} (${operation.state.toString(2)})`);

    const declaration = decl({ name: 'width', value: operation });
    console.log(`Declaration state: ${declaration.state} (${declaration.state.toString(2)})`);
    console.log(`Declaration F_STATIC: ${declaration.hasFlag(F_STATIC)}`);
    console.log(`Declaration F_NON_STATIC: ${declaration.hasFlag(F_NON_STATIC)}`);

    // Create a container with the declaration
    console.log('\n--- Creating container with declaration ---');
    const container = new Rules([declaration]);
    console.log(`Container state: ${container.state} (${container.state.toString(2)})`);
    console.log(`Container F_STATIC: ${container.hasFlag(F_STATIC)}`);
    console.log(`Container F_NON_STATIC: ${container.hasFlag(F_NON_STATIC)}`);

    console.log('\n=== Isolation debug test complete ===');

    // The container should be F_NON_STATIC because the declaration contains an operation
    expect(container.hasFlag(F_STATIC)).toBe(false);
    expect(container.hasFlag(F_NON_STATIC)).toBe(true);
  });

  test('Debug createMultipleRules', () => {
    console.log('\n=== Starting createMultipleRules debug test ===');

    // Create the same structure as the isolation test
    const container = createMultipleRules([
      createStaticRuleset(el('.static-rule'), [
        decl({ name: 'color', value: any('red') }),
        decl({ name: 'background', value: any('blue') })
      ]),
      createOperation(),
      createStaticRuleset(el('.another-static-rule'), [
        decl({ name: 'border', value: any('1px solid black') })
      ])
    ]);

    console.log(`Container state: ${container.state} (${container.state.toString(2)})`);
    console.log(`Container F_STATIC: ${container.hasFlag(F_STATIC)}`);
    console.log(`Container F_NON_STATIC: ${container.hasFlag(F_NON_STATIC)}`);
    console.log(`Container F_MAY_ASYNC: ${container.hasFlag(F_MAY_ASYNC)}`);

    // Log what's inside the container
    console.log('\n--- Container contents ---');
    container.value.forEach((node, i) => {
      console.log(`Node ${i}: ${node.type} (state: ${node.state})`);
    });

    console.log('\n=== createMultipleRules debug test complete ===');

    // The container should be F_NON_STATIC because it contains a non-static child
    expect(container.hasFlag(F_STATIC)).toBe(false);
    expect(container.hasFlag(F_NON_STATIC)).toBe(true);
  });

  test('Simple adopt test', () => {
    console.log('\n=== Starting simple adopt test ===');

    // Create a container
    const container = new Rules([]);
    console.log(`Initial container state: ${container.state} (${container.state.toString(2)})`);

    // Adopt a static node
    const staticNode = new Any('red');
    container.adopt(staticNode);
    console.log(`After adopting static node: ${container.state} (${container.state.toString(2)})`);

    // Adopt a non-static node
    const nonStaticNode = new Operation([num(1), '+', num(2)]);
    container.adopt(nonStaticNode);
    console.log(`After adopting non-static node: ${container.state} (${container.state.toString(2)})`);

    // Adopt another static node
    const anotherStaticNode = new Any('blue');
    container.adopt(anotherStaticNode);
    console.log(`After adopting another static node: ${container.state} (${container.state.toString(2)})`);

    console.log(`Final F_STATIC: ${container.hasFlag(F_STATIC)}`);
    console.log(`Final F_NON_STATIC: ${container.hasFlag(F_NON_STATIC)}`);

    console.log('\n=== Simple adopt test complete ===');

    // The container should be F_NON_STATIC because it contains a non-static child
    expect(container.hasFlag(F_STATIC)).toBe(false);
    expect(container.hasFlag(F_NON_STATIC)).toBe(true);
  });

  test('Debug flag setting and reading', () => {
    console.log('\n=== Starting comprehensive flag debug test ===');

    // Test 1: Basic flag operations
    console.log('\n--- Test 1: Basic flag operations ---');
    const testNode = new Any('test');
    console.log(`Initial state: ${testNode.state} (${testNode.state.toString(2)})`);
    console.log(`Initial F_STATIC: ${testNode.hasFlag(F_STATIC)}`);
    console.log(`Initial F_NON_STATIC: ${testNode.hasFlag(F_NON_STATIC)}`);

    testNode.addFlag(F_STATIC);
    console.log(`After addFlag(F_STATIC): ${testNode.state} (${testNode.state.toString(2)})`);
    console.log(`F_STATIC: ${testNode.hasFlag(F_STATIC)}`);
    console.log(`F_NON_STATIC: ${testNode.hasFlag(F_NON_STATIC)}`);

    testNode.addFlag(F_NON_STATIC);
    console.log(`After addFlag(F_NON_STATIC): ${testNode.state} (${testNode.state.toString(2)})`);
    console.log(`F_STATIC: ${testNode.hasFlag(F_STATIC)}`);
    console.log(`F_NON_STATIC: ${testNode.hasFlag(F_NON_STATIC)}`);

    // Test 2: Operation constructor
    console.log('\n--- Test 2: Operation constructor ---');
    const operation = new Operation([num(1), '+', num(2)]);
    console.log(`Operation state: ${operation.state} (${operation.state.toString(2)})`);
    console.log(`Operation F_STATIC: ${operation.hasFlag(F_STATIC)}`);
    console.log(`Operation F_NON_STATIC: ${operation.hasFlag(F_NON_STATIC)}`);

    // Test 3: Ruleset constructor
    console.log('\n--- Test 3: Ruleset constructor ---');
    const testRuleset = ruleset({
      selector: sellist([sel([el('.test')])]),
      rules: rules([decl({ name: 'color', value: any('red') })])
    });
    console.log(`Ruleset state: ${testRuleset.state} (${testRuleset.state.toString(2)})`);
    console.log(`Ruleset F_STATIC: ${testRuleset.hasFlag(F_STATIC)}`);
    console.log(`Ruleset F_NON_STATIC: ${testRuleset.hasFlag(F_NON_STATIC)}`);

    // Test 4: Container with mixed children
    console.log('\n--- Test 4: Container with mixed children ---');
    const staticChild = new Any('static');
    const nonStaticChild = new Operation([num(1), '+', num(2)]);

    console.log(`Static child state: ${staticChild.state} (${staticChild.state.toString(2)})`);
    console.log(`Non-static child state: ${nonStaticChild.state} (${nonStaticChild.state.toString(2)})`);

    const container = new Rules([staticChild, nonStaticChild]);
    console.log(`Container state: ${container.state} (${container.state.toString(2)})`);
    console.log(`Container F_STATIC: ${container.hasFlag(F_STATIC)}`);
    console.log(`Container F_NON_STATIC: ${container.hasFlag(F_NON_STATIC)}`);

    // Test 5: Step-by-step adoption
    console.log('\n--- Test 5: Step-by-step adoption ---');
    const stepContainer = new Rules([]);
    console.log(`Step container initial state: ${stepContainer.state} (${stepContainer.state.toString(2)})`);

    stepContainer.adopt(staticChild);
    console.log(`After adopting static child: ${stepContainer.state} (${stepContainer.state.toString(2)})`);
    console.log(`F_STATIC: ${stepContainer.hasFlag(F_STATIC)}`);
    console.log(`F_NON_STATIC: ${stepContainer.hasFlag(F_NON_STATIC)}`);

    stepContainer.adopt(nonStaticChild);
    console.log(`After adopting non-static child: ${stepContainer.state} (${stepContainer.state.toString(2)})`);
    console.log(`F_STATIC: ${stepContainer.hasFlag(F_STATIC)}`);
    console.log(`F_NON_STATIC: ${stepContainer.hasFlag(F_NON_STATIC)}`);

    console.log('\n=== Comprehensive flag debug test complete ===');
  });
});
