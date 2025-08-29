import { JessCompiler } from '../../src';

describe('Debug Mixin Call', () => {
  const compiler = new JessCompiler();

  it('should handle basic mixin call', async () => {
    const lessCode = `
      .config() {
        primary: red;
        secondary: blue;
      }

      @config: .config();

      .test {
        color: red;
      }
    `;

    const css = await compiler.renderString(lessCode);
    console.log('CSS output:', css);
    expect(css).toContain('color: red');
  });
});
