import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';

describe('Token Debug', () => {
  const compiler = new JessCompiler();

  it('should debug tokens for .mixin()', async () => {
    const lessCode = `.mixin() { color: red; }`;

    try {
      // Try to get the tokens to see what's happening
      const css = await compiler.renderString(lessCode);
      expect(css).toBeDefined();
    } catch (error) {
      // Let's see if we can get more details about the tokenization
      throw error;
    }
  });

  it('should debug tokens for .test', async () => {
    const lessCode = `.test { color: red; }`;

    try {
      const css = await compiler.renderString(lessCode);
      expect(css).toBeDefined();
    } catch (error) {
      throw error;
    }
  });
});
