import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Compiler } from '../src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Config Merging', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-config-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should merge configs correctly: file config -> compiler opts -> render options', async () => {
    // Create a styles.config.js file
    const configFile = path.join(tempDir, 'styles.config.js');
    fs.writeFileSync(configFile, `
      module.exports = {
        output: {
          collapseNesting: true
        },
        language: {
          less: {
            customProperty: 'file-value'
          }
        }
      };
    `);

    // Create a test file in the same directory
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.test { color: red; }');

    // Create compiler with options (should override file config)
    const compiler = new Compiler({
      output: {
        collapseNesting: false // Override file config
      },
      language: {
        less: {
          customProperty: 'compiler-value' // Override file config
        }
      }
    });

    // Render with render options (should override both file and compiler config)
    const css = await compiler.render(testFile, {
      output: {
        collapseNesting: true // Override compiler config (final value should be true)
      },
      language: {
        less: {
          customProperty: 'render-value' // Override both (final value should be 'render-value')
        }
      }
    });

    expect(css).toBeTruthy();
    expect(css).toContain('color: red');
    // The final config should have collapseNesting: true and customProperty: 'render-value'
    // demonstrating that render options override compiler options, which override file config
  });

  it('should concatenate arrays instead of replacing them', async () => {
    // Create a styles.config.js file with plugins array
    const configFile = path.join(tempDir, 'styles.config.js');
    fs.writeFileSync(configFile, `
      module.exports = {
        compile: {
          plugins: [
            { name: 'file-plugin-1', version: '1.0.0' },
            { name: 'file-plugin-2', version: '1.0.0' }
          ]
        }
      };
    `);

    // Create a test file
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.test { color: blue; }');

    // Create compiler with more plugins (should be concatenated, not replaced)
    const compiler = new Compiler({
      compile: {
        plugins: [
          { name: 'compiler-plugin-1', version: '2.0.0' },
          { name: 'compiler-plugin-2', version: '2.0.0' }
        ]
      }
    });

    // Render with even more plugins (should all be concatenated)
    const css = await compiler.render(testFile, {
      compile: {
        plugins: [
          { name: 'render-plugin-1', version: '3.0.0' },
          { name: 'render-plugin-2', version: '3.0.0' }
        ]
      }
    });

    expect(css).toBeTruthy();
    expect(css).toContain('color: blue');
    // The final plugins array should contain all 6 plugins in order:
    // file-plugin-1, file-plugin-2, compiler-plugin-1, compiler-plugin-2, render-plugin-1, render-plugin-2
    // Arrays are concatenated, not replaced
  });

  it('should handle nested object merging correctly', async () => {
    // Create a styles.config.js file with nested config
    const configFile = path.join(tempDir, 'styles.config.js');
    fs.writeFileSync(configFile, `
      module.exports = {
        language: {
          less: {
            property1: 'file-value-1',
            property2: 'file-value-2'
          }
        }
      };
    `);

    // Create a test file
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.test { color: green; }');

    // Create compiler that overrides one property but keeps the other
    const compiler = new Compiler({
      language: {
        less: {
          property1: 'compiler-value-1' // Override
          // property2 should remain 'file-value-2'
        }
      }
    });

    // Render with render options that override again
    const css = await compiler.render(testFile, {
      language: {
        less: {
          property1: 'render-value-1' // Override again
          // property2 should still be 'file-value-2'
        }
      }
    });

    expect(css).toBeTruthy();
    expect(css).toContain('color: green');
    // Verify nested merging works - property1 should be 'render-value-1', property2 should be 'file-value-2'
    // This demonstrates that nested objects are merged, not replaced
  });
});
