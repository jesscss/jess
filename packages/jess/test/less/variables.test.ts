import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

describe('Variables', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe('Basic Variable Declaration and Usage', () => {
    it('should handle simple variable declaration and usage', async () => {
      const lessCode = `
        @color: red;
        .test {
          color: @color;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle variable hoisting', async () => {
      const lessCode = `
        .test {
          color: @color;
        }
        @color: red;
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });

    it.skip('should handle variable shadowing', async () => {
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.my-class');
    });

    it('should handle variable interpolation in property names', async () => {
      const lessCode = `
        @prop: color;
        
        .test {
          @{prop}: red;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle variable interpolation in URLs', async () => {
      const lessCode = `
        @path: 'images';
        @file: 'logo.png';
        
        .test {
          background-image: url('@{path}/@{file}');
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('class: my-test-class');
    });
  });

  describe('Variable call with mixin reference', () => {
    it.skip('errors when variable holds mixin reference but mixin does not exist', async () => {
      // @foo: .a; @foo(); — .a is not defined as mixin, so eval should error at @foo().
      const lessCode = `
        @foo: .a;
        @foo();
      `;

      const result = await compiler.renderToResult(
        { source: lessCode, language: 'less' }
      );
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });

    it.skip('passes when variable holds mixin reference and mixin exists', async () => {
      const lessCode = `
.a() {
  color: blue;
}
@foo: .a;
@foo();
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: blue');
    });

    it('no error when mixin reference is not called', async () => {
      // @foo: .a; with no @foo(); — parses and compiles (no eval of .a).
      const lessCode = `
        @foo: .a;
        .bar { color: red; }
      `;

      const result = await compiler.renderToResult(
        { source: lessCode, language: 'less' }
      );
      expect(result.errors.length).toBe(0);
      expect(result.css).toContain('color: red');
    });

    it('can use mixin reference variable as selector', async () => {
      // @foo: .a; then use @{foo} as selector — .a need not exist as mixin.
      const lessCode = `
.a() {
  color: blue;
}
@foo: .a;
@{foo} {
  color: green;
}
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.a');
      expect(css).toContain('color: green');
    });
  });
});
