/**
 * The output number policy, end to end: one computed number prints the SAME digits
 * whatever position it lands in. The interpolation splice used to bypass the policy
 * and emit the raw double, so `pi()` printed two ways in one stylesheet.
 */
import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: {
    plugins: [
      lessPlugin(),
      lessCompatPlugin()
    ]
  }
});

async function render(less: string): Promise<string> {
  return compiler.renderString(less, { extension: '.less' });
}

describe('numeric precision is one policy for every position', () => {
  it('prints a computed number identically in a value and in an interpolation splice', async () => {
    const css = await render(`
      @n: pi();
      .a {
        width: @n;
        content: ~"@{n}";
      }
    `);

    expect(css).toContain('width: 3.1415926536;');
    expect(css).toContain('content: 3.1415926536;');
  });

  it('prints a computed number identically in a property name', async () => {
    const css = await render(`
      @n: pi();
      .a { prop-@{n}: 1; }
    `);

    expect(css).toContain('prop-3.1415926536: 1;');
  });

  it('removes float noise but keeps digits that are earned', async () => {
    const css = await render('.a { a: 0.1 + 0.2; b: (100% / 3); }');

    expect(css).toContain('a: 0.3;');
    expect(css).toContain('b: 33.333333333%;');
  });

  it('keeps a computed small magnitude that the old 8-decimal floor flattened to 0', async () => {
    const css = await render('.a { a: 0.0000001 * 0.01; }');

    expect(css).toContain('a: 0.000000001;');
  });

  it('keeps a SOURCE literal below the old floor instead of denoising it to 0', async () => {
    const css = await render('.a { a: 0.00000000123456789; b: -0.0000000001px; }');

    expect(css).toContain('a: 0.00000000123456789;');
    expect(css).toContain('b: -0.0000000001px;');
  });

  it('leaves an un-operated source literal verbatim', async () => {
    const css = await render('.a { a: 1.50000px; b: 2PX; }');

    expect(css).toContain('a: 1.50000px;');
    expect(css).toContain('b: 2PX;');
  });

  it('normalizes a leading-decimal literal by INSERTING the zero, not reformatting', async () => {
    const css = await render('.a { a: .3s; b: -.3s; c: .50000px; d: .30000000000000004px; }');

    expect(css).toContain('a: 0.3s;');
    expect(css).toContain('b: -0.3s;');
    // The authored digits survive the spelling rule — the number policy governs
    // computed values, not literals.
    expect(css).toContain('c: 0.50000px;');
    expect(css).toContain('d: 0.30000000000000004px;');
  });
});
