import { JessCompiler } from '../../src';

describe('Property Accessor Cases', () => {
  const compiler = new JessCompiler();

  it('should handle all property accessor cases correctly', async () => {
    const lessCode = `
      @key: primary;
      @config: .colors();
      .colors() {
        @key: red;
        key: blue;
        @primary: green;
        primary: yellow;
      }

      .test {
        // Case 1: @config[@key] - look for literal "@key" declaration
        color1: @config[@key];
        
        // Case 2: @config[key] - look for literal "key" declaration  
        color2: @config[key];
        
        // Case 3: @config[@@key] - evaluate @key to "primary", then look for "@primary"
        color3: @config[@@key];
        
        // Case 4: @config[$@key] - evaluate @key to "primary", then look for "primary"
        color4: @config[$@key];
        
        // Case 5: @config[@$key] - evaluate $key to "primary", then look for "@primary"
        color5: @config[@$key];
        
        // Case 6: @config[$$key] - evaluate $key to "primary", then look for "primary"
        color6: @config[$$key];
      }
    `;

    const css = await compiler.renderString(lessCode);
    
    // Expected results based on the rules:
    // color1: @colors[@key] should return red (literal "@key")
    // color2: @colors[key] should return blue (literal "key")  
    // color3: @colors[@@key] should return green (evaluate @key="primary", then "@primary")
    // color4: @colors[$@key] should return yellow (evaluate @key="primary", then "primary")
    // color5: @colors[@$key] should return green (evaluate $key="primary", then "@primary")
    // color6: @colors[$$key] should return yellow (evaluate $key="primary", then "primary")
    
    expect(css).toContain('color1: red');
    expect(css).toContain('color2: blue');
    expect(css).toContain('color3: green');
    expect(css).toContain('color4: yellow');
    expect(css).toContain('color5: green');
    expect(css).toContain('color6: yellow');
  });
});
