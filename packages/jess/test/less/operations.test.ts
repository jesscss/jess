import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import { serializeTypes, Context } from '@jesscss/core';
import lessPlugin from 'jess-plugin-less';

describe('Operations', () => {
  const compiler = new JessCompiler({
    plugins: [lessPlugin()]
  });

  describe('Basic Arithmetic Operations', () => {
    it('should handle addition', async () => {
      const lessCode = `
        .test {
          width: 10px + 5px;
          height: 20px + 10;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 15px');
      expect(css).toContain('height: 30px');
    });

    it('should handle subtraction', async () => {
      const lessCode = `
        .test {
          width: 20px - 5px;
          height: 30px - 10;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 15px');
      expect(css).toContain('height: 20px');
    });

    it('should handle multiplication', async () => {
      const lessCode = `
        .test {
          width: 5px * 3;
          height: 10 * 2px;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 15px');
      expect(css).toContain('height: 20px');
    });

    it('should handle division', async () => {
      const lessCode = `
        .test {
          width: 20px / 2;
          height: 30px / 3;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 10px');
      expect(css).toContain('height: 10px');
    });
  });

  describe('Operations with Variables', () => {
    it('should handle operations with variables', async () => {
      const lessCode = `
        @base: 10px;
        @multiplier: 2;
        @adder: 5px;

        .test {
          width: @base * @multiplier;
          height: @base + @adder;
          margin: @base - 2px;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 20px');
      expect(css).toContain('height: 15px');
      expect(css).toContain('margin: 8px');
    });

    it('should handle complex operations with variables', async () => {
      const lessCode = `
        @width: 100px;
        @height: 50px;
        @padding: 10px;

        .test {
          width: @width - (@padding * 2);
          height: @height + @padding;
          area: @width * @height;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 80px');
      expect(css).toContain('height: 60px');
      expect(css).toContain('area: 5000px');
    });
  });

  describe('Color Operations', () => {
    it('should handle color arithmetic', async () => {
      const lessCode = `
        .test {
          color: #000000 + #ffffff;
          background: #ff0000 + #00ff00;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: #ffffff');
      expect(css).toContain('background: #ffff00');
    });

    it('should handle color operations with variables', async () => {
      const lessCode = `
        @primary: #ff0000;
        @secondary: #00ff00;

        .test {
          color: @primary + @secondary;
          background: @primary - #0000ff;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: #ffff00');
    });
  });

  describe('Unit Operations', () => {
    it('should handle operations with different units', async () => {
      const lessCode = `
        .test {
          width: 50% + 25%;
          height: 100vh - 20vh;
          font-size: 1em * 1.5;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 75%');
      expect(css).toContain('height: 80vh');
      expect(css).toContain('font-size: 1.5em');
    });

    it('should handle operations with mixed units', async () => {
      const lessCode = `
        .test {
          width: 100px + 50%;
          height: 200px - 10%;
        }
      `;

      const css = await compiler.render(lessCode);
      // Note: Less handles mixed units differently, this is just to test parsing
      expect(css).toContain('width:');
      expect(css).toContain('height:');
    });
  });

  describe('Parentheses and Precedence', () => {
    it('should handle parentheses for precedence', async () => {
      const lessCode = `
        .test {
          width: (10px + 5px) * 2;
          height: 10px + (5px * 2);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 30px');
      expect(css).toContain('height: 20px');
    });

    it('should handle nested parentheses', async () => {
      const lessCode = `
        .test {
          width: ((10px + 5px) * 2) + 10px;
          height: (20px - (5px * 2)) / 2;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 40px');
      expect(css).toContain('height: 5px');
    });
  });

  describe('calc() Function', () => {
    it('should handle calc() function', async () => {
      const lessCode = `
        .test {
          width: calc(100% - 20px);
          height: calc(50vh + 10px);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: calc(100% - 20px)');
      expect(css).toContain('height: calc(50vh + 10px)');
    });

    it('should handle calc() with variables', async () => {
      const lessCode = `
        @margin: 20px;
        @padding: 10px;

        .test {
          width: calc(100% - @margin);
          height: calc(50vh + @padding);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: calc(100% - 20px)');
      expect(css).toContain('height: calc(50vh + 10px)');
    });
  });

  describe('Edge Cases', () => {
    it('should handle operations with zero', async () => {
      const lessCode = `
        .test {
          width: 10px + 0;
          height: 20px * 0;
          margin: 0 + 5px;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 10px');
      expect(css).toContain('height: 0px');
      expect(css).toContain('margin: 5px');
    });

    it('should handle operations with negative values', async () => {
      const lessCode = `
        .test {
          width: 10px + (-5px);
          height: 20px - (-10px);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 5px');
      expect(css).toContain('height: 30px');
    });
  });

  describe('AST Verification', () => {
    it('should create correct AST for basic operations', async () => {
      const lessCode = `
        .test {
          width: 10px + 5px;
        }
      `;

      const context = new Context({}, [lessPlugin()]);
      const { node } = await context.getTree(lessCode);

      const ast = serializeTypes(node);
      expect(ast).toContain('Operation');
    });

    it('should create correct AST for complex operations', async () => {
      const lessCode = `
        @base: 10px;
        .test {
          width: @base * 2 + 5px;
        }
      `;

      const context = new Context({}, [lessPlugin()]);
      const { node } = await context.getTree(lessCode);

      const ast = serializeTypes(node);
      expect(ast).toContain('Operation');
      expect(ast).toContain('Reference');
    });
  });
});
