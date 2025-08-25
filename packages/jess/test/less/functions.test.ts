import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import { serializeTypes, Context } from '@jesscss/core';
import lessPlugin from 'jess-plugin-less';

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

      const css = await compiler.render(lessCode);
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

      const css = await compiler.render(lessCode);
      expect(css).toContain('color:');
      expect(css).toContain('background:');
    });

    it('should handle saturate function', async () => {
      const lessCode = `
        .test {
          color: saturate(#888888, 20%);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color:');
    });

    it('should handle desaturate function', async () => {
      const lessCode = `
        .test {
          color: desaturate(#ff0000, 20%);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color:');
    });

    it('should handle fade function', async () => {
      const lessCode = `
        .test {
          color: fade(#ff0000, 50%);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color:');
    });

    it('should handle mix function', async () => {
      const lessCode = `
        .test {
          color: mix(#ff0000, #0000ff, 50%);
        }
      `;

      const css = await compiler.render(lessCode);
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

      const css = await compiler.render(lessCode);
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

      const css = await compiler.render(lessCode);
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

      const css = await compiler.render(lessCode);
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

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 50%');
      expect(css).toContain('height: 25%');
    });
  });

  describe('Built-in String Functions', () => {
    it('should handle escape function', async () => {
      const lessCode = `
        .test {
          content: escape("Hello World!");
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('content:');
    });

    it('should handle e function', async () => {
      const lessCode = `
        .test {
          filter: e("ms:alwaysHasItsOwnSyntax.For.Stuff()");
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('filter:');
    });
  });

  describe('Built-in List Functions', () => {
    it('should handle length function', async () => {
      const lessCode = `
        @list: 1px solid black;
        .test {
          length: length(@list);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('length: 3');
    });

    it('should handle extract function', async () => {
      const lessCode = `
        @list: 1px solid black;
        .test {
          first: extract(@list, 1);
          second: extract(@list, 2);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('first: 1px');
      expect(css).toContain('second: solid');
    });
  });

  describe('Built-in Type Functions', () => {
    it('should handle isnumber function', async () => {
      const lessCode = `
        .test {
          is-number: isnumber(123);
          is-not-number: isnumber("string");
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-number: true');
      expect(css).toContain('is-not-number: false');
    });

    it('should handle isstring function', async () => {
      const lessCode = `
        .test {
          is-string: isstring("hello");
          is-not-string: isstring(123);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-string: true');
      expect(css).toContain('is-not-string: false');
    });

    it('should handle iscolor function', async () => {
      const lessCode = `
        .test {
          is-color: iscolor(#ff0000);
          is-not-color: iscolor("red");
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-color: true');
      expect(css).toContain('is-not-color: false');
    });

    it('should handle iskeyword function', async () => {
      const lessCode = `
        .test {
          is-keyword: iskeyword(hello);
          is-not-keyword: iskeyword("hello");
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-keyword: true');
      expect(css).toContain('is-not-keyword: false');
    });

    it('should handle isurl function', async () => {
      const lessCode = `
        .test {
          is-url: isurl(url("test.jpg"));
          is-not-url: isurl("test.jpg");
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-url: true');
      expect(css).toContain('is-not-url: false');
    });

    it('should handle ispixel function', async () => {
      const lessCode = `
        .test {
          is-pixel: ispixel(10px);
          is-not-pixel: ispixel(10em);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-pixel: true');
      expect(css).toContain('is-not-pixel: false');
    });

    it('should handle isem function', async () => {
      const lessCode = `
        .test {
          is-em: isem(10em);
          is-not-em: isem(10px);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-em: true');
      expect(css).toContain('is-not-em: false');
    });

    it('should handle ispercentage function', async () => {
      const lessCode = `
        .test {
          is-percentage: ispercentage(50%);
          is-not-percentage: ispercentage(50px);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-percentage: true');
      expect(css).toContain('is-not-percentage: false');
    });

    it('should handle isunit function', async () => {
      const lessCode = `
        .test {
          is-unit: isunit(10px, px);
          is-not-unit: isunit(10em, px);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('is-unit: true');
      expect(css).toContain('is-not-unit: false');
    });
  });

  describe('Built-in Misc Functions', () => {
    it('should handle default function', async () => {
      const lessCode = `
        .test {
          value: default();
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('value:');
    });

    it('should handle unit function', async () => {
      const lessCode = `
        .test {
          unit: unit(10px);
          unit-with-unit: unit(10px, em);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('unit: px');
      expect(css).toContain('unit-with-unit: 10em');
    });

    it('should handle getunit function', async () => {
      const lessCode = `
        .test {
          unit: getunit(10px);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('unit: px');
    });
  });

  describe('Function with Variables', () => {
    it('should handle functions with variable parameters', async () => {
      const lessCode = `
        @color: #ff0000;
        @amount: 20%;

        .test {
          color: lighten(@color, @amount);
          background: darken(@color, @amount);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('color:');
      expect(css).toContain('background:');
    });

    it('should handle functions with computed parameters', async () => {
      const lessCode = `
        @base: 10px;
        @multiplier: 2;

        .test {
          width: round(@base * @multiplier);
          height: ceil(@base / @multiplier);
        }
      `;

      const css = await compiler.render(lessCode);
      expect(css).toContain('width: 20px');
      expect(css).toContain('height: 5px');
    });
  });

  describe('AST Verification', () => {
    it('should create correct AST for function calls', async () => {
      const lessCode = `
        .test {
          color: lighten(red, 20%);
        }
      `;

      const context = new Context({}, [lessPlugin()]);
      const { node } = await context.getTree(lessCode);

      const ast = serializeTypes(node);
      expect(ast).toContain('Call');
    });

    it('should create correct AST for function with variables', async () => {
      const lessCode = `
        @color: red;
        .test {
          color: lighten(@color, 20%);
        }
      `;

      const context = new Context({}, [lessPlugin()]);
      const { node } = await context.getTree(lessCode);

      const ast = serializeTypes(node);
      expect(ast).toContain('Call');
      expect(ast).toContain('Reference');
    });
  });
});
