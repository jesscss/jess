import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

describe('Functions', () => {
  const compiler = new JessCompiler({
    plugins: [lessPlugin()]
  });

  describe('Built-in Color Functions', () => {
    it('should handle lighten function', async () => {
      const lessCode = `
        .test {
          color: lighten(#000000, 50%);
          background: lighten(red, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
      expect(css).toContain('background:');
    });

    it('should handle darken function', async () => {
      const lessCode = `
        .test {
          color: darken(#ffffff, 50%);
          background: darken(blue, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
      expect(css).toContain('background:');
    });

    it('should handle saturate function', async () => {
      const lessCode = `
        .test {
          color: saturate(#888888, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
    });

    it('should handle desaturate function', async () => {
      const lessCode = `
        .test {
          color: desaturate(#ff0000, 20%);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
    });

    it('should handle fade function', async () => {
      const lessCode = `
        .test {
          color: fade(#ff0000, 50%);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
    });

    it('should handle mix function', async () => {
      const lessCode = `
        .test {
          color: mix(#ff0000, #0000ff, 50%);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
    });
  });

  describe('Built-in Math Functions', () => {
    it('should handle round function', async () => {
      const lessCode = `
        .test {
          width: round(3.7px);
          height: round(2.3em);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 4px');
      expect(css).toContain('height: 2em');
    });

    it('should handle ceil function', async () => {
      const lessCode = `
        .test {
          width: ceil(3.1px);
          height: ceil(2.9em);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 4px');
      expect(css).toContain('height: 3em');
    });

    it('should handle floor function', async () => {
      const lessCode = `
        .test {
          width: floor(3.9px);
          height: floor(2.1em);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 3px');
      expect(css).toContain('height: 2em');
    });

    it('should handle percentage function', async () => {
      const lessCode = `
        .test {
          width: percentage(0.5);
          height: percentage(0.25);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width: 50%');
      expect(css).toContain('height: 25%');
    });
  });

  describe('Built-in String Functions', () => {
    it('should handle escape function', async () => {
      const lessCode = `
        .test {
          content: escape("a=1");
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('content:');
    });

    it('should handle e function', async () => {
      const lessCode = `
        .test {
          content: e("hello");
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('content: hello');
    });
  });

  describe('Built-in List Functions', () => {
    it('should handle length function', async () => {
      const lessCode = `
        .test {
          count: length(1 2 3);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('count:');
    });

    it('should handle extract function', async () => {
      const lessCode = `
        .test {
          value: extract(1 2 3, 2);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('value:');
    });
  });

  describe('Built-in Type Functions', () => {
    it('should handle isnumber function', async () => {
      const lessCode = `
        .test {
          result: isnumber(42);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle isstring function', async () => {
      const lessCode = `
        .test {
          result: isstring("hello");
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle iscolor function', async () => {
      const lessCode = `
        .test {
          result: iscolor(#ff0000);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle iskeyword function', async () => {
      const lessCode = `
        .test {
          result: iskeyword(red);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle isurl function', async () => {
      const lessCode = `
        .test {
          result: isurl(url("test.png"));
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle ispixel function', async () => {
      const lessCode = `
        .test {
          result: ispixel(10px);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle isem function', async () => {
      const lessCode = `
        .test {
          result: isem(1.5em);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle ispercentage function', async () => {
      const lessCode = `
        .test {
          result: ispercentage(50%);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });

    it('should handle isunit function', async () => {
      const lessCode = `
        .test {
          result: isunit(10px, px);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('result:');
    });
  });

  describe('Built-in Misc Functions', () => {
    it('should handle default function', async () => {
      const lessCode = `
        .test {
          value: default();
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('value:');
    });

    it('should handle unit function', async () => {
      const lessCode = `
        .test {
          value: unit(10px);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('value:');
    });

    it('should handle getunit function', async () => {
      const lessCode = `
        .test {
          value: getunit(10px);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('value:');
    });
  });

  describe('Function with Variables', () => {
    it('should handle functions with variable parameters', async () => {
      const lessCode = `
        @color: #ff0000;
        @amount: 20%;
        
        .test {
          color: lighten(@color, @amount);
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color:');
    });

    it('should handle functions with computed parameters', async () => {
      const lessCode = `
        @base: 10;
        @multiplier: 2;
        
        .test {
          width: (@base * @multiplier)px;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('width:');
    });
  });
});
