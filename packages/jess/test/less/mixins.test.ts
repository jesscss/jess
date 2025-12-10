import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

describe('Mixins', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe('Basic Mixins', () => {
    it('should handle simple mixin definition and usage', async () => {
      const lessCode = `
        .mixin() {
          color: red;
          background: blue;
        }
        
        .test {
          .mixin();
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });

    it('should handle mixin without parentheses', async () => {
      const lessCode = `
        .mixin {
          color: red;
        }
        
        .test {
          .mixin;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle multiple mixin calls', async () => {
      const lessCode = `
        .mixin1() {
          color: red;
        }
        
        .mixin2() {
          background: blue;
        }
        
        .test {
          .mixin1();
          .mixin2();
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });
  });

  describe('Mixin Parameters', () => {
    it('should handle mixin with parameters', async () => {
      const lessCode = `
        .mixin(@color) {
          color: @color;
        }
        
        .test {
          .mixin(red);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle mixin with multiple parameters', async () => {
      const lessCode = `
        .mixin(@color, @size) {
          color: @color;
          font-size: @size;
        }
        
        .test {
          .mixin(red, 16px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
    });

    it('should handle mixin with default parameter values', async () => {
      const lessCode = `
        .mixin(@color: red, @size: 16px) {
          color: @color;
          font-size: @size;
        }
        
        .test1 {
          .mixin();
        }
        
        .test2 {
          .mixin(blue);
        }
        
        .test3 {
          .mixin(blue, 20px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
      expect(css).toContain('.test3');
      expect(css).toContain('font-size: 20px');
    });

    it('should handle named parameters', async () => {
      const lessCode = `
        .mixin(@color: red, @size: 16px) {
          color: @color;
          font-size: @size;
        }
        
        .test {
          .mixin(@size: 20px, @color: blue);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: blue');
      expect(css).toContain('font-size: 20px');
    });
  });

  describe('Mixin Guards', () => {
    it('should handle mixin with when guard', async () => {
      const lessCode = `
        .mixin(@color) when (@color = red) {
          color: @color;
          background: white;
        }
        
        .mixin(@color) when (@color = blue) {
          color: @color;
          background: black;
        }
        
        .test1 {
          .mixin(red);
        }
        
        .test2 {
          .mixin(blue);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('background: white');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
      expect(css).toContain('background: black');
    });

    it('should handle mixin with default guard', async () => {
      const lessCode = `
        .mixin(@color) when (@color = red) {
          color: @color;
        }
        
        .mixin(@color) {
          color: blue;
        }
        
        .test1 {
          .mixin(red);
        }
        
        .test2 {
          .mixin(green);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
    });
  });

  describe('Mixin Pattern Matching', () => {
    it('should handle mixin with pattern matching #1', async () => {
      const lessCode = `
        .mixin(@color, @size) when (@size > 10px) {
          color: @color;
          font-size: @size;
        }
        
        .mixin(@color, @size) when (@size <= 10px) {
          color: @color;
          font-size: 10px;
        }
        
        .test1 {
          .mixin(red, 16px);
        }
        
        .test2 {
          .mixin(blue, 8px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('.test2');
      expect(css).toContain('font-size: 10px');
    });

    it('should handle mixin with pattern matching #2', async () => {
      const lessCode = `
        .mixin(red) {
          color: red;
        }
        
        .mixin(blue) {
          color: blue;
        }
        
        .test1 {
          .mixin(red);
        }
        
        .test2 {
          .mixin(blue);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.test1');
      expect(css).toContain('color: red');
      expect(css).toContain('.test2');
      expect(css).toContain('color: blue');
    });
  });

  describe('Mixin Nesting', () => {
    it('should handle nested mixins', async () => {
      const lessCode = `
        .outer(@color: red) {
          color: @color;
          
          .inner(@size) {
            font-size: @size;
          }
        }
        
        .test {
          .outer(red);
          .outer > .inner(16px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
    });
  });

  describe('Mixin with @arguments', () => {
    it('should handle mixin with @arguments', async () => {
      const lessCode = `
        .mixin(@color, @size) {
          color: @color;
          font-size: @size;
          args: @arguments;
        }
        
        .test {
          .mixin(red, 16px);
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
      expect(css).toContain('args: red, 16px');
    });
  });
});
