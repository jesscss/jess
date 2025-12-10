import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src';

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
