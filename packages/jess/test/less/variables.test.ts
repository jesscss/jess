import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import { Context } from '@jesscss/core';
import lessPlugin from 'jess-plugin-less';

describe('Variables', () => {
  const compiler = new JessCompiler({
    plugins: [lessPlugin()]
  });

  describe('Basic Variable Declaration and Usage', () => {
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

    it('should handle variable hoisting', async () => {
      const lessCode = `
        .test {
          color: @color;
        }
        @color: red;
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });

    it('should handle multiple variables', async () => {
      const lessCode = `
        @primary: blue;
        @secondary: green;
        @size: 16px;
        
        .test {
          color: @primary;
          background: @secondary;
          font-size: @size;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: blue');
      expect(css).toContain('background: green');
      expect(css).toContain('font-size: 16px');
    });
  });

  describe('Variable Scoping', () => {
    it('should handle nested variable scoping', async () => {
      const lessCode = `
        @global: red;
        
        .parent {
          @local: blue;
          color: @global;
          background: @local;
          
          .child {
            color: @local;
          }
        }
        
        .outside {
          color: @global;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });

    it('should handle variable shadowing', async () => {
      const lessCode = `
        @color: red;
        
        .test {
          @color: blue;
          color: @color;
        }
        
        .other {
          color: @color;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('.test');
      expect(css).toContain('color: blue');
      expect(css).toContain('.other');
      expect(css).toContain('color: red');
    });
  });

  describe('Variable Interpolation', () => {
    it('should handle variable interpolation in selectors', async () => {
      const lessCode = `
        @prefix: my;
        @suffix: class;
        
        .@{prefix}-@{suffix} {
          color: red;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('.my-class');
    });

    it('should handle variable interpolation in property names', async () => {
      const lessCode = `
        @prop: color;
        
        .test {
          @{prop}: red;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });

    it('should handle variable interpolation in URLs', async () => {
      const lessCode = `
        @path: images;
        @file: logo.png;
        
        .test {
          background-image: url('@{path}/@{file}');
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('background-image: url(\'images/logo.png\')');
    });
  });

  describe('Variable Operations', () => {
    it('should handle variable arithmetic', async () => {
      const lessCode = `
        @base: 10px;
        @multiplier: 2;
        
        .test {
          margin: @base * @multiplier;
          padding: @base + 5px;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('margin: 20px');
      expect(css).toContain('padding: 15px');
    });

    it('should handle variable concatenation', async () => {
      const lessCode = `
        @prefix: my-;
        @suffix: -class;
        
        .test {
          class: ~"@{prefix}test@{suffix}";
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('class: my-test-class');
    });
  });
});
