import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../src/index';
import { serializeTypes, Context } from '@jesscss/core';
import lessPlugin from 'jess-plugin-less';

describe('Property Accessor Serialize', () => {
  it('should show AST structure for property accessor', async () => {
    const compiler = new JessCompiler();
    
    const lessCode = `
.mk-map() {
    text: white;
    background: black;
}

@p: .mk-map();

h1 { color: @p[text]; }
`;

    // Write the test file
    const fs = await import('fs/promises');
    await fs.writeFile('./test-property-accessor-serialize.less', lessCode);

    try {
      // Get the AST without evaluating it
      const context = new Context({}, [lessPlugin()]);
      const { node } = await context.getTree('./test-property-accessor-serialize.less');
      
      console.log('=== AST Structure ===');
      console.log(serializeTypes(node));
      
      // Now try to evaluate it to see where it fails
      try {
        const evald = await node.eval(context);
        console.log('=== Evaluated AST ===');
        console.log(serializeTypes(evald));
      } catch (error) {
        console.log('=== Evaluation failed ===');
        console.log('Error:', error.message);
      }
      
    } catch (error) {
      console.error('Error:', error);
      throw error;
    } finally {
      // Clean up
      try {
        await fs.unlink('./test-property-accessor-serialize.less');
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});
