import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../src/index';

describe('Property Accessor', () => {
  it('should handle property accessors correctly', async () => {
    const compiler = new JessCompiler();

    const lessCode = `
.mk-map() {
    text: white;
    background: black;
}

@p: .mk-map();

h1 { color: @p[text]; }
`;

    // Write the test file
    const fs = await import('fs/promises');
    await fs.writeFile('./test-property-accessor.less', lessCode);

    try {
      const css = await compiler.render('./test-property-accessor.less');
      console.log('Generated CSS:', css);
      expect(css).toContain('color:white');
    } catch (error) {
      console.error('Error:', error);
      throw error;
    } finally {
      // Clean up
      try {
        await fs.unlink('./test-property-accessor.less');
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});
