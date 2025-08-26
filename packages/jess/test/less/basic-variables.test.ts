import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';

describe('Basic Variables', () => {
  const compiler = new JessCompiler();

  it('should handle simple variable declaration and usage', async () => {
    const lessCode = `
      @color: red;
      
      .test {
        color: @color;
      }
    `;

    const css = await compiler.renderString(lessCode);
    expect(css).toContain('color: red');
  });

  it('should handle multiple variables', async () => {
    const lessCode = `
      @primary: blue;
      @secondary: green;
      
      .test {
        color: @primary;
        background: @secondary;
      }
    `;

    const css = await compiler.renderString(lessCode);
    expect(css).toContain('color: blue');
    expect(css).toContain('background: green');
  });
});

