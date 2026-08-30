import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Less variable references through the public AST route', () => {
  async function parseAndRender(source: string): Promise<string> {
    const compiler = new Compiler();
    const context = compiler.createContext('entry.less');
    const parsed = await context.parseString(source, {
      filePath: 'entry.less',
      extension: '.less'
    });

    expect(parsed.node.type).toBe('Stylesheet');
    expect(context.document).toBe(parsed.node);
    return compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    });
  }

  it('should handle simple variable declaration and usage', async () => {
    const lessCode = `
      @myColor: red;
      
      .test {
        color: @myColor;
      }
    `;

    await expect(parseAndRender(lessCode)).resolves.toBe('.test {\n  color: red;\n}\n');
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

    await expect(parseAndRender(lessCode)).resolves.toBe('.test {\n  color: blue;\n  background: green;\n}\n');
  });
});
