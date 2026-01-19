import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Compiler } from '../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { serializeTypes } from '@jesscss/core';

describe.only('Debug extend structure from Less parser', () => {
  it('should inspect actual Less parser structure for .zap extend', async () => {
    // Parse the actual Less file to see what structure it creates
    const lessFile = join(__dirname, '../../../../less.js/packages/test-data/tests-unit/extend/extend.less');

    const compiler = new Compiler({
      compile: {
        plugins: [lessPlugin()]
      }
    });

    const context = compiler.createContext(lessFile);
    const { node: tree } = await context.getTree(lessFile);

    // Check BEFORE eval - what does the Less parser create?
    console.log('\n=== BEFORE EVAL ===');
    function findRulesetsRecursive(node: any, results: any[] = [], depth = 0): any[] {
      if (node.type === 'Ruleset') {
        results.push({ ruleset: node, depth });
      }
      // Check rules inside rulesets (nested rulesets)
      if (node.value?.rules?.value && Array.isArray(node.value.rules.value)) {
        for (const child of node.value.rules.value) {
          findRulesetsRecursive(child, results, depth + 1);
        }
      }
      // Check direct children
      if (node.value && Array.isArray(node.value)) {
        for (const child of node.value) {
          findRulesetsRecursive(child, results, depth);
        }
      }
      return results;
    }

    const rulesetsBefore = findRulesetsRecursive(tree);
    for (const { ruleset: rs, depth } of rulesetsBefore) {
      const selector = rs.selector;
      const selectorStr = selector?.valueOf();
      if (selectorStr?.includes('.ext8') && selectorStr?.includes('.ext9') && !selectorStr.includes('&')) {
        // Check if this ruleset has the "result: match-nested-bar" declaration
        const rules = rs.value?.rules?.value;
        if (rules && Array.isArray(rules)) {
          for (const rule of rules) {
            if (rule.type === 'Declaration' && rule.value?.name?.valueOf() === 'result') {
              const value = rule.value?.value?.valueOf();
              if (value === 'match-nested-bar') {
                console.log(`\n*** NESTED RULESET BEFORE EVAL (depth: ${depth}) ***`);
                console.log('Selector string:', selectorStr);
                console.log('Selector type:', selector?.type);
                console.log('Selector structure:', serializeTypes(selector, { showValues: true, maxStringLength: 200 }));
                if (selector?.type === 'SelectorList' && selector?.value) {
                  console.log('  SelectorList items:', selector.value.map((s: any) => s.valueOf()));
                } else if (selector?.type === 'ComplexSelector') {
                  console.log('  ComplexSelector components:', selector.value.map((c: any) => c.type === 'Combinator' ? `[${c.value}]` : c.valueOf()));
                }
                break;
              }
            }
          }
        }
      }
    }

    // Eval the tree to trigger extend processing
    await tree.eval(context);

    console.log('\n=== AFTER EVAL ===');

    // Access extends from context
    if (context.extends && context.extends.length > 0) {
      console.log('=== EXTENDS ===');
      console.log(`Total extends: ${context.extends.length}`);
      for (let i = 0; i < context.extends.length; i++) {
        const extend = context.extends[i]!;
        const [target, selectorWithExtend, partial, extendRoot, extendNode] = extend;

        const targetStr = target?.valueOf();
        const selectorStr = selectorWithExtend?.valueOf();

        // Look for .zap or .zoo extends
        if (selectorStr === '.zap' || selectorStr === '.zoo') {
          console.log(`\nExtend ${i}:`);
          console.log('Target:', targetStr);
          console.log('Target structure:', serializeTypes(target, { showValues: true, maxStringLength: 200 }));
          console.log('SelectorWithExtend:', selectorStr);
          console.log('Partial:', partial);
          console.log('ExtendNode:', serializeTypes(extendNode, { showValues: true, maxStringLength: 200 }));
        }
      }
    } else {
      console.log('=== EXTENDS ===');
      console.log('No extends found in context');
      console.log('Context keys:', Object.keys(context));
    }

    // Find .ext8 .ext9 ruleset by iterating through tree (including nested)
    console.log('\n=== RULESETS ===');
    function findRulesets(node: any, results: any[] = [], depth = 0): any[] {
      if (node.type === 'Ruleset') {
        results.push({ ruleset: node, depth });
      }
      // Check rules inside rulesets
      if (node.value?.rules?.value && Array.isArray(node.value.rules.value)) {
        for (const child of node.value.rules.value) {
          findRulesets(child, results, depth + 1);
        }
      }
      // Check direct children
      if (node.value && Array.isArray(node.value)) {
        for (const child of node.value) {
          findRulesets(child, results, depth);
        }
      }
      return results;
    }

    const rulesets = findRulesets(tree);
    for (const { ruleset: rs, depth } of rulesets) {
      const selector = rs.selector;
      const selectorStr = selector?.valueOf();
      if (selectorStr?.includes('.ext8') && selectorStr?.includes('.ext9') && !selectorStr.includes('&')) {
        console.log(`\nAFTER EVAL - Found .ext8 .ext9 ruleset (depth: ${depth}):`);
        console.log('Selector string:', selectorStr);
        console.log('Selector structure:', serializeTypes(selector, { showValues: true, maxStringLength: 200 }));
        // Check if this ruleset has the "result: match-nested-bar" declaration
        const rules = rs.value?.rules?.value;
        if (rules && Array.isArray(rules)) {
          for (const rule of rules) {
            if (rule.type === 'Declaration' && rule.value?.name?.valueOf() === 'result') {
              const value = rule.value?.value?.valueOf();
              console.log('  Has declaration: result =', value);
              if (value === 'match-nested-bar') {
                console.log('  *** THIS IS THE NESTED RULESET THAT SHOULD NOT HAVE .zap/.zoo ***');
                if (selectorStr.includes('.zap')) {
                  console.log('  ❌ BUG: .zap is incorrectly added!');
                }
                if (selectorStr.includes('.zoo')) {
                  console.log('  ❌ BUG: .zoo is incorrectly added!');
                }
              }
            }
          }
        }
      }
      if (selectorStr === '.zap' || selectorStr === '.zoo') {
        console.log(`\nFound ${selectorStr} ruleset (depth: ${depth}):`);
        console.log('Selector structure:', serializeTypes(selector, { showValues: true, maxStringLength: 200 }));
      }
    }

    // This test is just for inspection
    expect(true).toBe(true);
  });
});
