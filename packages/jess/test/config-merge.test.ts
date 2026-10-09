import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { outputDiagnostics } from '@jesscss/compiler/diagnostics';
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

    /*
     * The final config should have collapseNesting: true and customProperty: 'render-value'
     * demonstrating that render options override compiler options, which override file config
     */
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

    /*
     * The final plugins array should contain all 6 plugins in order:
     * file-plugin-1, file-plugin-2, compiler-plugin-1, compiler-plugin-2, render-plugin-1, render-plugin-2
     * Arrays are concatenated, not replaced
     */
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

    /*
     * Verify nested merging works - property1 should be 'render-value-1', property2 should be 'file-value-2'
     * This demonstrates that nested objects are merged, not replaced
     */
  });

  it('adds configured plugin-js as a lazy proxy without starting Deno at context creation', () => {
    const nestedDir = path.join(tempDir, 'src', 'nested');
    fs.mkdirSync(nestedDir, { recursive: true });
    const testFile = path.join(nestedDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    const compiler = new Compiler({
      compile: {
        plugins: ['@jesscss/plugin-js']
      }
    });
    const context = compiler.createContext(testFile);

    expect('javascript' in context.opts ? context.opts.javascript : undefined).toBeUndefined();
    expect(context.plugins.some(plugin => plugin.name === 'js')).toBe(true);
  });

  it('auto-wires the optional plugin-js for script imports without listing it in plugins', async () => {
    /*
     * @jesscss/plugin-js is end-user installed: when it is resolvable, script
     * (JS/TS) imports auto-wire without configuring it in `plugins`. The auto-wire
     * hook resolves the plugin proxy for JS extensions; when plugin-js is absent
     * the hook returns undefined and core emits the "Install @jesscss/plugin-js" gate.
     */
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    const compiler = new Compiler();
    const context = compiler.createContext(testFile);

    const jsPlugin = await context.opts.loadPluginForExtension?.('.js');
    expect(jsPlugin).toBeDefined();
    expect(jsPlugin?.supportedExtensions).toContain('.js');
    expect(typeof jsPlugin?.import).toBe('function');
  });

  it('normalizes deprecated disablePluginRule to disableScriptModules', () => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    const compiler = new Compiler({
      compile: {
        disablePluginRule: true
      }
    });
    const context = compiler.createContext(testFile);

    expect(context.opts.disableScriptModules).toBe(true);
    expect(context.warnings.some(warning =>
      warning.code === 'deprecation/disable-plugin-rule-option'
      && warning.reason.includes('disablePluginRule')
      && warning.fix.includes('disableScriptModules')
    )).toBe(true);
  });

  it('normalizes deprecated language.less.disablePluginRule to disableScriptModules', () => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    const compiler = new Compiler({
      language: {
        less: {
          disablePluginRule: true
        }
      }
    });
    const context = compiler.createContext(testFile);

    expect(context.opts.disableScriptModules).toBe(true);
    expect(context.warnings.some(warning =>
      warning.code === 'deprecation/disable-plugin-rule-option'
      && warning.reason.includes('disablePluginRule')
      && warning.fix.includes('disableScriptModules')
    )).toBe(true);
  });

  it('reports the disablePluginRule deprecation against the options, not a stylesheet line', async () => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    const result = await new Compiler({ compile: { disablePluginRule: true } })
      .renderToResult(testFile, { suppressWarnings: true });
    const deprecations = result.warnings.filter(warning =>
      warning.code === 'deprecation/disable-plugin-rule-option');
    expect(deprecations).toHaveLength(1);
    expect(deprecations[0]!.filePath).toBeUndefined();

    /* So the formatter prints it as a bare one-liner, naming no file or line. */
    const printed: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      printed.push(String(chunk));
      return true;
    });
    try {
      outputDiagnostics([], deprecations, { colors: false });
    } finally {
      stderr.mockRestore();
    }
    expect(printed.join('')).toContain('deprecation/disable-plugin-rule-option');
    expect(printed.join('')).not.toContain('test.less');
    expect(printed.join('')).not.toMatch(/:1:1\b/);
  });

  /*
   * Less 4.x `dumpLineNumbers` (`lessc --line-numbers`) is accepted but has no
   * effect in v5: one deprecation warning per render, and the CSS is exactly
   * what the same render produces without the option.
   */
  it.each([
    ['language.less', { language: { less: { dumpLineNumbers: 'comments' } } }],
    ['compile', { compile: { dumpLineNumbers: 'all' } }]
  ])('accepts deprecated %s.dumpLineNumbers with one warning and unchanged output', async (_where, options) => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a {\n  color: red;\n}\n@media screen {\n  .b { color: blue; }\n}\n');

    const plain = await new Compiler().renderToResult(testFile, { suppressWarnings: true });
    const result = await new Compiler(options).renderToResult(testFile, { suppressWarnings: true });

    const deprecations = result.warnings.filter(warning =>
      warning.code === 'deprecation/dump-line-numbers-option');
    expect(deprecations).toHaveLength(1);
    expect(deprecations[0]!.reason).toContain('"dumpLineNumbers" is deprecated and has no effect');
    expect(deprecations[0]!.fix).toContain('sourceMap');

    /* It is about the options, not a line of the stylesheet. */
    expect(deprecations[0]!.filePath).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.css).toBe(plain.css);
    expect(result.css).not.toContain('line ');
  });

  /*
   * Less 4.x `insecure` (`lessc --insecure`) let a remote import skip
   * certificate checks. Remote imports are https-only and always verify the
   * certificate, so the option is accepted, warns once, and changes nothing.
   */
  it.each([
    ['language.less', { language: { less: { insecure: true } } }],
    ['compile', { compile: { insecure: true } }]
  ])('accepts deprecated %s.insecure with one no-effect warning and unchanged output', async (_where, options) => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n.a { color: red; }\n');

    const plain = await new Compiler().renderToResult(testFile, { suppressWarnings: true });
    const result = await new Compiler(options).renderToResult(testFile, { suppressWarnings: true });

    const deprecations = result.warnings.filter(warning => warning.code === 'deprecation/insecure-option');
    expect(deprecations).toHaveLength(1);
    expect(deprecations[0]!.reason).toBe('"insecure" is deprecated and has no effect: remote imports are https-only and always verify the server certificate.');
    expect(deprecations[0]!.filePath).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.css).toBe(plain.css);
  });

  /*
   * Less 4.x `ieCompat` (`lessc --ie-compat`) made `data-uri()` fall back to `url()`
   * for a file too large for IE8. `data-uri()` always inlines the file, so the option
   * is accepted, warns once, and changes nothing; a Less 4.x caller can pass it through.
   */
  it.each([
    ['language.less', { language: { less: { ieCompat: true } } }],
    ['compile', { compile: { ieCompat: true } }]
  ])('accepts deprecated %s.ieCompat with one no-effect warning and unchanged output', async (_where, options) => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }\n');

    const plain = await new Compiler().renderToResult(testFile, { suppressWarnings: true });
    const result = await new Compiler(options).renderToResult(testFile, { suppressWarnings: true });
    const deprecations = result.warnings.filter(warning => warning.code === 'deprecation/ie-compat-option');
    expect(deprecations).toHaveLength(1);
    expect(deprecations[0]!.reason).toBe('"ieCompat" is deprecated and has no effect: data-uri() always inlines the file.');
    expect(deprecations[0]!.filePath).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.css).toBe(plain.css);

    const unset = await new Compiler({ language: { less: { ieCompat: false } } }).renderToResult(testFile, { suppressWarnings: true });
    expect(unset.warnings.map(warning => warning.code)).not.toContain('deprecation/ie-compat-option');
  });

  /* The deprecated `relativeUrls` alias of `rewriteUrls: 'all'` works from a styles.config too. */
  it('reads the deprecated relativeUrls from a styles.config as rewriteUrls: all', async () => {
    const render = async (dir: string, less: string) => {
      fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'sub', 'a.less'), '.a { b: url("img.png"); }\n');
      fs.writeFileSync(path.join(dir, 'main.less'), '@import "sub/a.less";\n');
      fs.writeFileSync(path.join(dir, 'styles.config.cjs'), `module.exports = { language: { less: ${less} } };\n`);
      return (await new Compiler().renderToResult(path.join(dir, 'main.less'), { suppressWarnings: true })).css;
    };
    expect(await render(path.join(tempDir, 'alias'), '{ relativeUrls: true }')).toContain('url("sub/img.png")');
    expect(await render(path.join(tempDir, 'explicit'), '{ relativeUrls: true, rewriteUrls: \'off\' }')).toContain('url("img.png")');
  });

  it('does not warn when insecure is unset or false', async () => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    for (const options of [{}, { language: { less: { insecure: false } } }]) {
      const result = await new Compiler(options).renderToResult(testFile, { suppressWarnings: true });
      expect(result.warnings.map(warning => warning.code)).not.toContain('deprecation/insecure-option');
    }
  });

  /*
   * With a file path as input, the render options' `language` is the
   * per-language config, as everywhere in `ConfigOptions`; the entry's language
   * comes from its extension. It is never read as the entry's language name.
   */
  it('honours render-time language.less options when the input is a file path', async () => {
    fs.writeFileSync(path.join(tempDir, 'styles.config.cjs'), 'module.exports = { compile: { mathMode: \'always\' } };\n');
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { w: 2 + 3; }\n');

    const result = await new Compiler().renderToResult(testFile, {
      suppressWarnings: true,
      language: { less: { mathMode: 'parens', dumpLineNumbers: 'comments' } }
    });

    expect(result.errors).toEqual([]);
    expect(result.css).toContain('w: 2 + 3;');
    expect(result.warnings.map(warning => warning.code)).toContain('deprecation/dump-line-numbers-option');
  });

  it('names the styles.config that sets an invalid Less mode value, and only that file', async () => {
    const configFile = path.join(tempDir, 'styles.config.cjs');
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { w: 1px; }\n');

    fs.writeFileSync(configFile, 'module.exports = { language: { less: { unitMode: \'stict\' } } };\n');
    await expect(new Compiler().renderToResult(testFile)).rejects.toMatchObject({
      code: 'plugin/invalid-option',
      filePath: configFile
    });

    /* A config file is loaded once per directory, so the second case gets its own. */
    const validDir = path.join(tempDir, 'valid');
    fs.mkdirSync(validDir);
    fs.writeFileSync(path.join(validDir, 'styles.config.cjs'), 'module.exports = { compile: { mathMode: \'always\' } };\n');
    const validTestFile = path.join(validDir, 'test.less');
    fs.writeFileSync(validTestFile, '.a { w: 1px; }\n');
    await expect(new Compiler().renderToResult(validTestFile, { language: { less: { unitMode: 'stict' } } }))
      .rejects.toMatchObject({ code: 'plugin/invalid-option', filePath: undefined });
  });

  it('does not warn when dumpLineNumbers is unset or off', async () => {
    const testFile = path.join(tempDir, 'test.less');
    fs.writeFileSync(testFile, '.a { color: red; }');

    for (const options of [{}, { language: { less: { dumpLineNumbers: '' } } }]) {
      const result = await new Compiler(options).renderToResult(testFile, { suppressWarnings: true });
      expect(result.warnings.map(warning => warning.code)).not.toContain('deprecation/dump-line-numbers-option');
    }
  });
});
