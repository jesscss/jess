import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Less mixins through the public AST route', () => {
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

  it('should parse simple mixin definition', async () => {
    const lessCode = `
      .mixin() {
        color: red;
      }
    `;

    await expect(parseAndRender(lessCode)).resolves.toBe('');
  });

  it('should parse mixin definition with parameters', async () => {
    const lessCode = `
      .mixin(@color) {
        color: @color;
      }
    `;

    await expect(parseAndRender(lessCode)).resolves.toBe('');
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

    await expect(parseAndRender(lessCode)).resolves.toBe('.test {\n  color: red;\n}\n');
  });
});
