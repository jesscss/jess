import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

describe.todo('Functions', () => {
  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe.todo('Expressions', () => {
    it('should handle parenthesis in expressions', async () => {
      const lessCode = `
        @var: 42;
        @media print {
            .class {
                color: blue;
                .sub {
                    width: @var;
                }
            }
            .top, header > h1 {
                color: (#222 * 2);
            }
        }
      `;
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('.class {');
      expect(css).toContain('color: blue;');
      expect(css).toContain('.class .sub {');
      expect(css).toContain('width: 42;');
      expect(css).toContain('color: #444444;');
    });
  });
});
