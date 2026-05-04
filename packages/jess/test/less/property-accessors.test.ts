import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

describe.todo('Property Accessors', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe.todo('Basic Property Accessors', () => {
    it('should handle simple property accessor', async () => {
      const lessCode = `
        .mk-map() {
          text: white;
          background: black;
        }

        @p: .mk-map();

        h1 { color: @p[text]; }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: blue');
      expect(css).toContain('background: green');
      expect(css).toContain('font-size: 16px');
    });

    it('should handle property accessor with nested rulesets', async () => {
      const lessCode = `
        @config: {
          @colors: {
            primary: red;
            secondary: blue;
          }
          @sizes: {
            small: 12px;
            large: 20px;
          }
        }

        .test {
          color: @config[@colors][primary];
          font-size: @config[@sizes][large];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 20px');
    });
  });

  describe.todo('Ambiguous mixin references', () => {
    it('should handle a color as a mixin reference', async () => {
      const lessCode = `
        #FF0 {
          color: red;
        }
        @ref: #FF0;

        .test {
          color: @ref[color];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });
  });

  describe.todo('Property Accessor with Variables', () => {
    it('should handle property accessor with variable keys', async () => {
      const lessCode = `
        .config() {
          primary: red;
          secondary: blue;
        }

        @config: .config();
        @key: primary;

        .test {
          color: @config[$@key];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle variable accessor with variable keys (#1)', async () => {
      const lessCode = `
        .config() {
          @primary: red;
          @secondary: blue;
        }

        @config: .config();
        @key: primary;

        .test {
          color: @config[@@key];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle variable accessor with variable keys (#2)', async () => {
      const lessCode = `
        .config() {
          @primary: red;
          @secondary: blue;
        }

        @config: .config();

        .test {
          key: primary;
          color: @config[@$key];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });

    it('should handle variable accessor with variable keys (#3)', async () => {
      const lessCode = `
        .config() {
          primary: red;
          secondary: blue;
        }

        @config: .config();

        .test {
          key: primary;
          color: @config[$$key];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
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
          @prop: @{prefix}@{suffix};
          color: @config[$@prop];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
    });
  });

  describe.todo('Property Accessor with Mixins', () => {
    it('should handle property accessor from mixin return value', async () => {
      const lessCode = `
        .get-config() {
          color: red;
          size: 16px;
        }

        @config: .get-config();

        .test {
          color: @config[color];
          font-size: @config[size];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('font-size: 16px');
    });

    it('should handle property accessor with mixin parameters', async () => {
      const lessCode = `
        .create-config(@theme) {
          color: @theme;
          background: white;
        }

        @config: .create-config(red);

        .test {
          color: @config[color];
          background: @config[background];
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('background: white');
    });
  });

  describe.todo('Property Accessor Edge Cases', () => {
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
      await expect(compiler.renderString(lessCode, { language: 'less' })).rejects.toThrow();
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
      await expect(compiler.renderString(lessCode, { language: 'less' })).rejects.toThrow();
    });
  });

  describe.todo('Property Accessor with Namespaces', () => {
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

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });
  });
});
