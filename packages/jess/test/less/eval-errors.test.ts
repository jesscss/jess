import { describe, expect, it } from 'vitest';
import lessPlugin from '@jesscss/plugin-less';
import { Compiler } from '../../src/index.js';

describe('Less ampersand merge template', () => {
  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: {
      plugins: [lessPlugin()]
    }
  });

  it('distributes template across comma-separated list items', async () => {
    const lessCode = `
      @list-quoted: ~'apple, satsuma, banana, pear';
      @{list-quoted} {
        .fruit-quoted-& {
          content: "Quoted";
        }
      }
    `;
    const css = await compiler.renderString(lessCode, { language: 'less' });
    expect(css).toContain('.fruit-quoted-apple');
    expect(css).toContain('.fruit-quoted-satsuma');
    expect(css).toContain('.fruit-quoted-banana');
    expect(css).toContain('.fruit-quoted-pear');
  });

  it('rejects invalid template joins per item', async () => {
    const lessCode = `
      .one, .two {
        .fruit-& {
          color: red;
        }
      }
    `;
    await expect(
      compiler.renderString(lessCode, { language: 'less' })
    ).rejects.toThrow('Invalid ampersand merge template');
  });
});
