import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';
import lessPlugin from 'jess-plugin-less';

describe('Property Accessor', () => {
  it('should handle property accessors correctly', async () => {
    const compiler = new JessCompiler({
      plugins: [lessPlugin()]
    });

    const lessCode = `
.mk-map() {
    text: white;
    background: black;
}

@p: .mk-map();

h1 { color: @p[text]; }
`;

    try {
      const css = await compiler.renderString(lessCode);
      expect(css).toContain('color: white');
    } catch (error) {
      throw error;
    }
  });
});
