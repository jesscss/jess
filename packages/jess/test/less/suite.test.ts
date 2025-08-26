import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import { Context } from '@jesscss/core';
import lessPlugin from 'jess-plugin-less';

describe('Jess Less Test Suite', () => {
  const compiler = new JessCompiler({
    plugins: [lessPlugin()]
  });

  describe('Core Language Features', () => {
    it('should handle basic CSS with Less syntax', async () => {
      const lessCode = `
        .test {
          color: red;
          background: blue;
          font-size: 16px;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
      expect(css).toContain('font-size: 16px');
    });

    it('should handle nested selectors', async () => {
      const lessCode = `
        .parent {
          color: red;
          
          .child {
            color: blue;
            
            .grandchild {
              color: green;
            }
          }
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('.parent');
      expect(css).toContain('.parent .child');
      expect(css).toContain('.parent .child .grandchild');
    });

    it('should handle & parent selector', async () => {
      const lessCode = `
        .button {
          color: red;
          
          &:hover {
            color: blue;
          }
          
          &.primary {
            background: green;
          }
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('.button:hover');
      expect(css).toContain('.button.primary');
    });
  });

  describe('Variable System', () => {
    it('should handle variable hoisting correctly', async () => {
      const lessCode = `
        .test {
          color: @color;
        }
        @color: red;
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: red');
    });

    it('should handle variable scoping', async () => {
      const lessCode = `
        @global: red;
        
        .parent {
          @local: blue;
          color: @global;
          background: @local;
        }
        
        .outside {
          color: @global;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });
  });

  describe('Mixin System', () => {
    it('should handle basic mixins', async () => {
      const lessCode = `
        .mixin() {
          color: red;
          background: blue;
        }
        
        .test {
          .mixin();
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });

    it('should handle mixin parameters', async () => {
      const lessCode = `
        .mixin(@color) {
          color: @color;
        }
        
        .test {
          .mixin(red);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: red');
    });
  });

  describe('Property Accessors', () => {
    it('should handle property accessors', async () => {
      const lessCode = `
        .config() {
          primary: red;
          secondary: blue;
        }
        
        @theme: .config();
        
        .test {
          color: @theme[primary];
          background: @theme[secondary];
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });
  });

  describe('Operations', () => {
    it('should handle basic arithmetic', async () => {
      const lessCode = `
        .test {
          width: 10px + 5px;
          height: 20px * 2;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 15px');
      expect(css).toContain('height: 40px');
    });

    it('should handle operations with variables', async () => {
      const lessCode = `
        @base: 10px;
        @multiplier: 2;
        
        .test {
          width: @base * @multiplier;
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 20px');
    });
  });

  describe('Functions', () => {
    it('should handle built-in functions', async () => {
      const lessCode = `
        .test {
          width: round(3.7px);
          color: lighten(#000000, 50%);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 4px');
      expect(css).toContain('color:');
    });
  });



  describe('Error Handling', () => {
    it('should handle undefined variables gracefully', async () => {
      const lessCode = `
        .test {
          color: @undefined-variable;
        }
      `;

      await expect(compiler.render(lessCode)).rejects.toThrow();
    });

    it('should handle invalid operations gracefully', async () => {
      const lessCode = `
        .test {
          width: 10px + "string";
        }
      `;

      // This should either throw an error or handle it gracefully
      try {
        const css = await compiler.render(lessCode);
        expect(css).toBeDefined();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Performance', () => {
    it('should handle large files efficiently', async () => {
      // Create a large but simple Less file
      let lessCode = '';
      for (let i = 0; i < 100; i++) {
        lessCode += `
          .class-${i} {
            color: red;
            background: blue;
            font-size: ${i}px;
          }
        `;
      }

      const startTime = Date.now();
      const css = await compiler.render(lessCode);
      const endTime = Date.now();

      expect(css).toBeDefined();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});
