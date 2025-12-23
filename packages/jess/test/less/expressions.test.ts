import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src';
import { Context } from '@jesscss/core';
import lessPlugin from '@jesscss/plugin-less';

describe('Functions', () => {
  const compiler = new Compiler({
    compile: {
      plugins: [lessPlugin()]
    }
  });

  describe('Expressions', () => {
    it('should handle parenthesis in expressions', async () => {
      const lessCode = `
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
      expect(css).toBeString(`
        @media print {
            .class {
                color: blue;
            }
            .class .sub {
                width: 42;
            }
            .top,
            header > h1 {
                color: #444444;
            }
        }
      `);
    });
  });
});
