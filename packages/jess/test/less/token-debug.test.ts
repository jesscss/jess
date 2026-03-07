import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Token Debug', () => {
  const compiler = new Compiler();

  it('should debug tokens for .mixin()', async () => {
    const lessCode = `.mixin() { color: red; }`;

    try {
      // Try to get the tokens to see what's happening
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toBeDefined();
    } catch (error) {
      // Let's see if we can get more details about the tokenization
      throw error;
    }
  });

  it('should debug tokens for .test', async () => {
    const lessCode = `.test { color: red; }`;

    try {
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toBeDefined();
    } catch (error) {
      throw error;
    }
  });
});
