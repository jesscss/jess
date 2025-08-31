import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';

describe('Static Names', () => {
  const compiler = new JessCompiler();

  describe('Declaration Names', () => {
    it('should handle static declaration names', async () => {
      const lessCode = `
        @color: red;
        @size: 20px;
        
        .test {
          color: @color;
          margin: @size;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('margin: 20px');
    });

    it('should handle static mixin names', async () => {
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

    it('should handle static ruleset names', async () => {
      const lessCode = `
        .ruleset {
          color: red;
        }
        
        .test {
          .ruleset();
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
    });
  });

  describe('Lookup', () => {
    it('should find static variable declarations', async () => {
      const lessCode = `
        @primary: blue;
        @secondary: green;
        
        .test {
          color: @primary;
          background: @secondary;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: blue');
      expect(css).toContain('background: green');
    });

    it('should find static mixin definitions', async () => {
      const lessCode = `
        .button() {
          padding: 10px;
          border: 1px solid black;
        }
        
        .primary {
          .button();
          background: blue;
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('padding: 10px');
      expect(css).toContain('border: 1px solid black');
      expect(css).toContain('background: blue');
    });

    it('should handle scoping for static names', async () => {
      const lessCode = `
        @global: red;
        
        .container {
          @local: blue;
          
          .nested {
            color: @global;
            background: @local;
          }
        }
      `;

      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: red');
      expect(css).toContain('background: blue');
    });
  });
});
