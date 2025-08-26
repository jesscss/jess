import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';

describe('Token Debug', () => {
  const compiler = new JessCompiler();

  it('should debug tokens for .mixin()', async () => {
    const lessCode = `.mixin() { color: red; }`;

    try {
      // Try to get the tokens to see what's happening
      const css = await compiler.renderString(lessCode);
      console.log('CSS output:', css);
      expect(css).toBeDefined();
    } catch (error) {
      console.error('Parse error:', error);
      // Let's see if we can get more details about the tokenization
      throw error;
    }
  });

  it('should debug tokens for .test', async () => {
    const lessCode = `.test { color: red; }`;

    try {
      const css = await compiler.renderString(lessCode);
      console.log('CSS output:', css);
      expect(css).toBeDefined();
    } catch (error) {
      console.error('Parse error:', error);
      throw error;
    }
  });
});
