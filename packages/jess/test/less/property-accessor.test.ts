import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';

describe.todo('Property Accessor', () => {
  it('should handle property accessors correctly', async () => {
    const compiler = new Compiler({
      compile: {
        plugins: [lessPlugin()]
      }
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
      const css = await compiler.renderString(lessCode, { language: 'less' });
      expect(css).toContain('color: white');
    } catch (error) {
      throw error;
    }
  });
});
