import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
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
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });

    it('should handle nested selectors', async () => {
      const lessCode = `
        .parent {
          color: red;
          .child {
            background: blue;
            .grandchild {
              border: 1px solid black;
            }
          }
        }
      `;

      const css = await compiler.renderString(lessCode);
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
          &.active {
            color: green;
          }
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('.button:hover');
      expect(css).toContain('.button.active');
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

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });

    it('should handle variable scoping', async () => {
      const lessCode = `
        @color: red;
        .parent {
          @color: blue;
          .child {
            color: @color;
          }
        }
        .other {
          color: @color;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('.parent .child');
      expect(css).toContain('.other');
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });
  });

  describe('Property Accessors', () => {
    it('should handle property accessors', async () => {
      const lessCode = `
        @config: {
          color: red;
          size: 10px;
        };
        .test {
          color: @config[color];
          font-size: @config[size];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 10px');
    });
  });

  describe('Operations', () => {
    it('should handle basic arithmetic', async () => {
      const lessCode = `
        .test {
          width: 10px + 5px;
          height: 20px - 5px;
          margin: 2px * 3;
          padding: 10px / 2;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 15px');
      expect(css).toContain('height: 15px');
      expect(css).toContain('margin: 6px');
      expect(css).toContain('padding: 5px');
    });

    it('should handle operations with variables', async () => {
      const lessCode = `
        @base: 10px;
        @multiplier: 2;
        .test {
          width: @base * @multiplier;
          height: @base + 5px;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 20px');
      expect(css).toContain('height: 15px');
    });
  });

  describe('Functions', () => {
    it('should handle built-in functions', async () => {
      const lessCode = `
        .test {
          color: lighten(#000000, 50%);
          width: round(3.7px);
          content: escape("a=1");
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
      expect(css).toContain('width:');
      expect(css).toContain('content:');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid syntax gracefully', async () => {
      const lessCode = `
        .test {
          color: red;
          invalid-syntax
        }
      `;

      await expect(compiler.renderString(lessCode)).rejects.toThrow();
    });
  });

  describe('Import System', () => {
    it('should handle @import statements', async () => {
      const lessCode = `
        @import "test-import.less";
        .test {
          color: red;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });
  });

  describe('Performance', () => {
    it('should handle large files efficiently', async () => {
      const lessCode = `
        ${Array(100).fill(0).map((_, i) => `
          .class-${i} {
            color: red;
            background: blue;
            margin: ${i}px;
          }
        `).join('')}
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('.class-0');
      expect(css).toContain('.class-99');
    });
  });
});
