import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('Less mixin lookup scope behavior', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [
        lessPlugin({
          mathMode: 0
        })
      ]
    }
  });

  it('should test variable lookup from mixin definition vs caller context', async () => {
    // Test 1: Variable defined in caller context
    const test1 = `
      @color: red;
      .mixin {
        color: @color;
      }
      .caller {
        @color: blue;
        .mixin();
      }
    `;
    const result1 = await compiler.renderString(test1, { language: 'less' });
    console.log('Test 1 - Variable in caller context:');
    console.log(result1);
    // Expected: Does it use 'red' (from mixin definition) or 'blue' (from caller)?
  });

  it('should test variable lookup from mixin definition context', async () => {
    // Test 2: Variable defined in mixin definition context
    const test2 = `
      .mixin {
        @color: green;
        color: @color;
      }
      .caller {
        .mixin();
        background: @color; // Does this find the variable from mixin?
      }
    `;
    const result2 = await compiler.renderString(test2, { language: 'less' });
    console.log('Test 2 - Variable in mixin definition:');
    console.log(result2);
    // Expected: Does the caller see the variable defined in the mixin?
  });

  it('should test mixin lookup from mixin definition vs caller context', async () => {
    // Test 3: Mixin lookup from within a mixin
    const test3 = `
      .nested-mixin {
        color: blue;
      }
      .mixin {
        .nested-mixin(); // Can it find this?
      }
      .caller {
        .nested-mixin {
          color: red;
        }
        .mixin(); // Does it use the nested-mixin from caller or definition?
      }
    `;
    const result3 = await compiler.renderString(test3, { language: 'less' });
    console.log('Test 3 - Mixin lookup from within mixin:');
    console.log(result3);
    // Expected: Which nested-mixin does it use?
  });

  it('should test precedence when both contexts have the same variable', async () => {
    // Test 4: Same variable in both contexts
    const test4 = `
      @color: red;
      .mixin {
        @color: green;
        color: @color;
      }
      .caller {
        @color: blue;
        .mixin();
      }
    `;
    const result4 = await compiler.renderString(test4, { language: 'less' });
    console.log('Test 4 - Precedence with same variable:');
    console.log(result4);
    // Expected: Which @color takes precedence?
  });

  it.skip('should test nested mixin calls and lookup scope', async () => {
    // Test 5: Nested mixin calls
    const test5 = `
      .inner-mixin {
        color: @color;
      }
      .outer-mixin {
        @color: purple;
        .inner-mixin();
      }
      .caller {
        @color: orange;
        .outer-mixin();
      }
    `;
    const result5 = await compiler.renderString(test5, { language: 'less' });
    console.log('Test 5 - Nested mixin calls:');
    console.log(result5);
    // Expected: What @color does inner-mixin use?
  });
});
