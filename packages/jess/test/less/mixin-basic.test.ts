import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';

describe('Basic Mixins', () => {
  const compiler = new JessCompiler();

  it('should parse simple mixin definition', async () => {
    const lessCode = `
      .mixin() {
        color: red;
      }
    `;

    try {
      const css = await compiler.renderString(lessCode);
      expect(css).toBeDefined();
    } catch (error) {
      throw error;
    }
  });

  it('should parse mixin definition with parameters', async () => {
    const lessCode = `
      .mixin(@color) {
        color: @color;
      }
    `;

    try {
      const css = await compiler.renderString(lessCode);
      expect(css).toBeDefined();
    } catch (error) {
      throw error;
    }
  });

  it('should parse mixin call', async () => {
    const lessCode = `
      .mixin() {
        color: red;
      }
      
      .test {
        .mixin();
      }
    `;

    try {
      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    } catch (error) {
      throw error;
    }
  });
});
