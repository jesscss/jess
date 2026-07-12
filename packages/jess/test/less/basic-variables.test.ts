import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe.todo('Basic Variables', () => {
  const compiler = new Compiler();

  it('should handle simple variable declaration and usage', async () => {
    const lessCode = `
      @myColor: red;
      
      .test {
        color: @myColor;
      }
    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    expect(css).toContain('color: red');
  });

  it('should handle multiple variables', async () => {
    const lessCode = `
      @myPrimary: blue;
      @mySecondary: green;
      
      .test {
        color: @myPrimary;
        background: @mySecondary;
      }
    `;

    const css = await compiler.renderString(lessCode, { language: 'less' });
    expect(css).toContain('color: blue');
    expect(css).toContain('background: green');
  });
});
