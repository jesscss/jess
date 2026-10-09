import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';

describe('Interpolated Names', () => {
  const compiler = new Compiler();

  describe('Declaration Names', () => {
    it('should handle interpolated declaration names', async () => {
      const lessCode = `
        @prefix: color;
        @suffix: red;
        
        .@{prefix}-@{suffix} {
          @{prefix}: @suffix;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.color-red');
      expect(css).toContain('color: red');
    });

    it('should handle interpolated property names', async () => {
      const lessCode = `
        @property: background;
        
        .test {
          @{property}: blue;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('background: blue');
    });
  });

  describe('Selectors', () => {
    it('should keep a leading selector interpolation before a combinator', async () => {
      expect(await compiler.renderString('@s: ~".q"; @{s} .r { a: b }', { language: 'less' }))
        .toBe('.q .r {\n  a: b;\n}\n');
      expect(await compiler.renderString('@s: ~".q"; @{s} > .r { a: b }', { language: 'less' }))
        .toBe('.q > .r {\n  a: b;\n}\n');
      expect(await compiler.renderString('@s: q; @{s} .r { a: b }', { language: 'less' }))
        .toBe('q .r {\n  a: b;\n}\n');
    });

    it('should write an interpolated namespace prefix as the namespace', async () => {
      expect(await compiler.renderString('@ns: svg; @{ns}|a { c: 1; } .x @{ns}|* { c: 2; }', { language: 'less' }))
        .toBe('svg|a {\n  c: 1;\n}\n.x svg|* {\n  c: 2;\n}\n');
    });

    /*
     * An inline extend on a selector an interpolation leads extends from the
     * resolved selector, as an interpolated extender does (X7); lessc 4.9.1
     * parses it and drops the extend.
     */
    it('should extend from a selector an interpolation leads', async () => {
      expect(await compiler.renderString('@s: ~".q"; @{s} .r:extend(.z) { c: 1; } .z { d: 2; }', { language: 'less' }))
        .toBe('.q .r {\n  c: 1;\n}\n.z,\n.q .r {\n  d: 2;\n}\n');
      expect(await compiler.renderString('@s: q; .p { @{s} > .r:extend(.z) { c: 1; } } .z { d: 2; }', { language: 'less' }))
        .toBe('.p {\n  q > .r {\n    c: 1;\n  }\n}\n.z,\n.p q > .r {\n  d: 2;\n}\n');
    });
  });

  describe('Lookup', () => {
    it('should find declarations with interpolated names', async () => {
      const lessCode = `
        @type: primary;
        @value: blue;
        
        .@{type} {
          color: @value;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.primary');
      expect(css).toContain('color: blue');
    });

    it('should handle dependencies between interpolated names', async () => {
      const lessCode = `
        @base: theme;
        @variant: dark;
        @full: @{base}-@{variant};
        
        .@{full} {
          background: black;
        }
      `;

      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.theme-dark');
      expect(css).toContain('background: black');
    });
  });
});
