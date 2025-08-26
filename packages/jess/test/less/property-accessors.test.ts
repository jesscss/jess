import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import { Context } from '@jesscss/core';
import lessPlugin from 'jess-plugin-less';

describe('Property Accessors', () => {
  const compiler = new JessCompiler({
    plugins: [lessPlugin()]
  });

  describe('Basic Property Accessors', () => {
    it('should handle simple property accessor', async () => {
      const lessCode = `
        .mk-map() {
          text: white;
          background: black;
        }

        @p: .mk-map();

        h1 { color: @p[text]; }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: white');
    });

    it('should handle property accessor with multiple properties', async () => {
      const lessCode = `
        .config() {
          primary: blue;
          secondary: green;
          size: 16px;
        }

        @theme: .config();

        .test {
          color: @theme[primary];
          background: @theme[secondary];
          font-size: @theme[size];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: blue');
      expect(css).toContain('background: green');
      expect(css).toContain('font-size: 16px');
    });

    it('should handle property accessor with nested rulesets', async () => {
      const lessCode = `
        .nested-config() {
          colors: {
            primary: red;
            secondary: blue;
          }
          sizes: {
            small: 12px;
            large: 20px;
          }
        }

        @config: .nested-config();

        .test {
          color: @config[colors][primary];
          font-size: @config[sizes][large];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 20px');
    });
  });

  describe('Property Accessor with Variables', () => {
    it('should handle property accessor with variable keys', async () => {
      const lessCode = `
        .config() {
          primary: red;
          secondary: blue;
        }

        @config: .config();
        @key: primary;

        .test {
          color: @config[@key];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });

    it('should handle property accessor with computed keys', async () => {
      const lessCode = `
        .config() {
          primary: red;
          secondary: blue;
        }

        @config: .config();
        @prefix: pri;
        @suffix: mary;

        .test {
          color: @config[@{prefix}@{suffix}];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });
  });

  describe('Property Accessor with Mixins', () => {
    it('should handle property accessor from mixin return value', async () => {
      const lessCode = `
        .get-config() {
          return {
            color: red;
            size: 16px;
          }
        }

        @config: .get-config();

        .test {
          color: @config[color];
          font-size: @config[size];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
    });

    it('should handle property accessor with mixin parameters', async () => {
      const lessCode = `
        .create-config(@theme) {
          return {
            color: @theme;
            background: white;
          }
        }

        @config: .create-config(red);

        .test {
          color: @config[color];
          background: @config[background];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: white');
    });
  });

  describe('Property Accessor Edge Cases', () => {
    it('should handle property accessor with non-existent property', async () => {
      const lessCode = `
        .config() {
          primary: red;
        }

        @config: .config();

        .test {
          color: @config[primary];
          background: @config[secondary];
        }
      `;

      // This should throw an error for the non-existent property
      await expect(compiler.renderString(lessCode)).rejects.toThrow();
    });

    it('should handle property accessor with empty ruleset', async () => {
      const lessCode = `
        .empty-config() {
        }

        @config: .empty-config();

        .test {
          color: @config[any-property];
        }
      `;

      // This should throw an error for accessing property from empty ruleset
      await expect(compiler.renderString(lessCode)).rejects.toThrow();
    });
  });

  describe('Property Accessor with Namespaces', () => {
    it('should handle property accessor with namespace', async () => {
      const lessCode = `
        #namespace {
          .scoped-mixin() {
            color: red;
            background: blue;
          }
        }

        @mixin: #namespace > .scoped-mixin();

        .test {
          color: @mixin[color];
          background: @mixin[background];
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });
  });
});
