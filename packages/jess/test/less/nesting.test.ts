import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe('Nesting', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe('Some nesting test cases', () => {
    it('should handle nested selectors', async () => {
      const lessCode = `
        @media (-o-min-device-pixel-ratio: ~"2/1"), (min-resolution: 2dppx) {
          .parent {
            .child {
              width: 10px;
            }
          }
        }
      `;
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toBeString(`
        @media (-o-min-device-pixel-ratio: 2/1), (min-resolution: 2dppx) {
          .parent {
            .child {
              width: 10px;
            }
          }
        }
      `);
    });
  });
});