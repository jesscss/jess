import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 80px');
      expect(css).toContain('height: 60px');
      expect(css).toContain('area: 5000px');
    });

    it('should preserve spacing', async () => {
      const lessCode = `
        .test {
          foo: 1 + 2 calc(3 + 4) 5 + 6;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('foo: 3 7 11');
    });

    it('should reduce calc operations and expressions', async () => {
      const lessCode = `
        @val: 10px;
        .no-math {
          @c: 10px + 20px;
          @calc: (@val + 30px);
          root: calc(100% - @c);
          root2: calc(100% - @calc);
          @var: 50vh/2;
          width: calc(50% + (@var - 20px));
          height: calc(50% + ((@var - 20px)));
          min-height: calc(((10vh)) + calc((5vh)));
          foo: 1 + 2 calc(3 + 4) 5 + 6;
          @floor: floor(1 + .1);
          bar: calc(@floor + 20%);
        }

        .b {
          @a: 10px;
          @b: 10px;

          one: calc(100% - ((min(@a + @b))));
          two: calc(100% - (((@a + @b))));
          three: calc(e('100%') - (3 * 1));
          four: calc(~'100%' - (3 * 1));
          nested: calc(calc(2.25rem + 2px) - 1px * 2);
        }

        .c {
          @v: 10px;
          height: calc(100% - ((@v * 3) + (@v * 2)));
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContainString(`
        .no-math {
          root: calc(100% - 30px);
          root2: calc(100% - 40px);
          width: calc(50% + (25vh - 20px));
          height: calc(50% + (25vh - 20px));
          min-height: 15vh;
          foo: 3 7 11;
          bar: calc(1 + 20%);
        }
        .b {
          one: calc(100% - 20px);
          two: calc(100% - 20px);
          three: calc(100% - 3);
          four: calc(100% - 3);
          nested: calc((2.25rem + 2px) - 2px);
        }
        .c {
          height: calc(100% - 50px);
        }
      `);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
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

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 5px');
      expect(css).toContain('height: 30px');
    });
  });
});
